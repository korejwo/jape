/*
  JAPE - Jagged Alliance 2 Person Editor, JavaScript port.
  Original Java version written 1999-2008 by Douglas Greiman.

  This software may be used and distributed according to the terms
  of the GNU Public License, incorporated herein by reference.

  User interface (jQuery). Port of JapeFrame, StatPanel, ItemPanel,
  ItemDetailPanel, the field views, OptionDialog and JapeAbout, plus:
    - only characters on the player's team (marked *) are editable,
    - inventory slots for helmet / body armor / leg armor / head gear only
      accept matching items,
    - ammo and attachment lists are limited to what fits the item,
    - numeric input is clamped to the field's range.
*/
(function ($, J) {
  'use strict';

  var CAT = J.CAT;
  var M = J.Mercenary;

  // ===========================================================================
  // Field views (NumberView / TextView / ChoiceView)
  // ===========================================================================

  /**
   * Common behaviour of a control bound to one named field of a structure.
   * A "masked" view stays bound but shows an empty value; it is used for
   * fields that are meaningless for the current item type.
   */
  function BaseView(fieldName) {
    this.fieldName = fieldName;
    this.struct = null;
    this.masked = false;
    this.listeners = [];
  }
  BaseView.prototype.onChange = function (fn) {
    this.listeners.push(fn);
    return this;
  };
  BaseView.prototype.fire = function (oldValue, newValue) {
    var self = this;
    this.listeners.forEach(function (fn) { fn(self, oldValue, newValue); });
  };
  BaseView.prototype.setStruct = function (struct) { this.struct = struct; };
  BaseView.prototype.field = function () {
    return this.struct ? this.struct.field(this.fieldName) : null;
  };
  BaseView.prototype.setEnabled = function (enabled) { this.$el.prop('disabled', !enabled); };
  BaseView.prototype.setMasked = function (masked) {
    if (this.masked !== masked) {
      this.masked = masked;
      this.refresh();
    }
  };

  /** Text box for a numeric or string field. */
  function InputView(fieldName, cssClass) {
    BaseView.call(this, fieldName);
    var self = this;
    this.$el = $('<input type="text" class="field" autocomplete="off" spellcheck="false">')
      .addClass(cssClass)
      .attr('aria-label', fieldName);
    this.$el.on('input', function () { self.handleInput(); });
    // Show the stored (normalised) value once the user leaves the box.
    this.$el.on('blur', function () { self.refresh(); });
  }
  InputView.prototype = Object.create(BaseView.prototype);

  InputView.prototype.refresh = function () {
    var f = this.field();
    if (f) {
      this.$el.attr('maxlength', f.kind === 'string' ? f.maxChars : String(f.max).length);
    }
    var value = f && !this.masked ? this.struct.get(this.fieldName) : null;
    this.$el.val(value === null ? '' : value);
  };

  InputView.prototype.handleInput = function () {
    var f = this.field();
    if (!f) { return; }
    var el = this.$el[0];
    var raw = el.value;
    if (f.kind === 'string') {
      this.commit(raw);
      return;
    }
    // Digits only, clamped to the field's range. An empty box means 0,
    // like the original.
    var digits = raw.replace(/\D+/g, '');
    var n = digits === '' ? 0 : parseInt(digits, 10);
    if (n > f.max) {
      n = f.max;
      digits = String(n);
    }
    if (digits !== raw) { el.value = digits; }
    this.commit(n);
  };

  InputView.prototype.commit = function (value) {
    var f = this.field();
    if (!f) { return; }
    var isString = f.kind === 'string';
    var old = isString ? this.struct.get(this.fieldName) : this.struct.getInt(this.fieldName);
    if (old === value) { return; }
    if (isString) {
      this.struct.set(this.fieldName, value);
    } else {
      this.struct.setInt(this.fieldName, value);
    }
    this.fire(old, value);
  };

  /** Programmatic change; like AWT setText it notifies listeners. */
  InputView.prototype.setValue = function (value) {
    this.commit(value);
    this.refresh();
  };

  /** Drop-down list for a ChoiceField. Option values are numeric ids. */
  function ChoiceView(fieldName, cssClass, options) {
    BaseView.call(this, fieldName);
    var self = this;
    this.$el = $('<select class="field">').addClass(cssClass).attr('aria-label', fieldName);
    this.optionKey = null;
    this.setOptions(options);
    this.$el.on('change', function () { self.commit(parseInt(self.$el.val(), 10)); });
  }
  ChoiceView.prototype = Object.create(BaseView.prototype);

  /** @param options array of {id, name}; must include id 0 (None). */
  ChoiceView.prototype.setOptions = function (options) {
    var key = options.map(function (o) { return o.id; }).join(',');
    if (key === this.optionKey) { return; }
    this.optionKey = key;
    var frag = document.createDocumentFragment();
    options.forEach(function (o) {
      frag.appendChild($('<option>').val(String(o.id)).text(o.name)[0]);
    });
    this.$el.empty().append(frag);
  };

  ChoiceView.prototype.select = function (value) {
    this.$el.find('option.extra').remove();
    if (this.$el.find('option[value="' + value + '"]').length === 0) {
      // Value from the file that is not offered for this slot/item.
      var f = this.field();
      var name = f ? f.names.nameOf(value) : undefined;
      $('<option class="extra">')
        .val(String(value))
        .text(name === undefined ? 'Unknown (' + value + ')' : name)
        .appendTo(this.$el);
    }
    this.$el.val(String(value));
  };

  ChoiceView.prototype.refresh = function () {
    var f = this.field();
    this.select(f && !this.masked ? this.struct.getInt(this.fieldName) : 0);
  };

  ChoiceView.prototype.commit = function (value) {
    var f = this.field();
    if (!f) { return; }
    var old = this.struct.getInt(this.fieldName);
    if (old === value) { return; }
    // Optional veto: the selection snaps back to the stored value.
    if (this.validate && !this.validate(old, value)) {
      this.refresh();
      return;
    }
    this.struct.setInt(this.fieldName, value);
    this.fire(old, value);
    this.refresh();
  };

  ChoiceView.prototype.setValue = function (value) {
    this.commit(value);
    this.refresh();
  };

  // ---- small DOM helpers --------------------------------------------------------

  function td(cls, text) {
    var $td = $('<td>');
    if (cls) { $td.addClass(cls); }
    if (text !== undefined) { $td.text(text); }
    return $td;
  }

  function spacer(colspan) {
    return $('<td>').attr('colspan', colspan);
  }

  // ===========================================================================
  // Stat panel
  // ===========================================================================

  function StatPanel($root, onChanged) {
    var self = this;
    this.views = [];
    this.viewByField = {};
    this.bumpButtons = [];
    this.onChanged = onChanged;

    var $table = $('<table class="grid stat-grid">');
    $table.append('<colgroup><col class="c-label"><col class="c-num"><col class="c-sep">' +
      '<col class="c-num"><col class="c-sep"><col class="c-num"><col></colgroup>');
    var $body = $('<tbody>').appendTo($table);

    function view(v) {
      self.views.push(v);
      self.viewByField[v.fieldName] = v;
      v.onChange(function (src, oldV, newV) { self.onChanged(src.fieldName, oldV, newV); });
      return v.$el;
    }
    function num(field) { return td(null).append(view(new InputView(field, 'num'))); }

    function stringRow(title, field) {
      $('<tr>').append(td('lbl', title),
        td(null).attr('colspan', 6).append(view(new InputView(field, 'text')))).appendTo($body);
    }
    function byteRow(title, field) {
      $('<tr>').append(td('lbl', title), num(field), spacer(5)).appendTo($body);
    }
    function incRow(title, field, incField, withBumps) {
      var $row = $('<tr>').append(td('lbl', title), num(field), td('sep right', '(+'), num(incField),
        td('sep', ')'));
      if (withBumps) {
        $row.append(td('bump').append(bumpButton(title, field, incField, 1)),
          td('bump').append(bumpButton(title, field, incField, 10)));
      } else {
        $row.append(spacer(2));
      }
      $row.appendTo($body);
    }
    function bumpButton(title, field, incField, amount) {
      var $b = $('<button type="button" class="btn bump">').text('+' + amount)
        .attr({
          title: 'Raise ' + title + ' by ' + amount + ' (up to ' + SKILL_MAX + '); the value in brackets grows by the same amount',
          'aria-label': title + ' +' + amount
        })
        .on('click', function () { self.bump(field, incField, amount); });
      self.bumpButtons.push($b);
      return $b;
    }
    function choiceRow(title, field) {
      var options = J.SKILL_NAMES.map(function (n, i) { return { id: i, name: n }; });
      return $('<tr>').append(td('lbl', title),
        td(null).attr('colspan', 6).append(view(new ChoiceView(field, 'skill', options)))).appendTo($body);
    }

    stringRow('Name', 'Name');
    stringRow('Nickname', 'Nickname');
    $('<tr>').append(td('lbl', 'Health'), num('Health'), td('sep center', '/'), num('Max Health'),
      td('sep right', '(+'), num('Health Inc'), td('sep', ')')).appendTo($body);
    byteRow('Energy', 'Energy');
    byteRow('Morale', 'Morale');
    // +1 / +10 buttons (JA2 1.0x saves only) on the rows marked true.
    incRow('Agility', 'Agility', 'Agility Inc', true);
    incRow('Dexterity', 'Dexterity', 'Dexterity Inc', true);
    incRow('Strength', 'Strength', 'Strength Inc', true);
    incRow('Leadership', 'Leadership', 'Leadership Inc');
    incRow('Wisdom', 'Wisdom', 'Wisdom Inc', true);
    incRow('Marksmanship', 'Marksmanship', 'Marksmanship Inc', true);
    incRow('Explosives', 'Explosives', 'Explosives Inc', true);
    incRow('Mechanical', 'Mechanical', 'Mechanical Inc', true);
    incRow('Medical', 'Medical', 'Medical Inc', true);
    incRow('Exp Lvl', 'Level', 'Level Inc');
    choiceRow('Skill1', 'Skill1');
    choiceRow('Skill2', 'Skill2');
    // JA2 1.13 characters can have more traits; shown only for those saves.
    this.$skill3Row = choiceRow('Skill3', 'Skill3').hide();
    byteRow('Kills', 'Kills');
    byteRow('Assists', 'Assists');
    byteRow('Shots Fired', 'Shots Fired');
    byteRow('Shots Hit', 'Shots Hit');
    byteRow('Battles', 'Battles');
    byteRow('Times Wounded', 'Wounds');

    $root.append($table);
    this.setActor(null, null, false);
  }

  /** Shows a profile, with the soldier's live values on top when present. */
  StatPanel.prototype.setActor = function (actor, merc, editable) {
    var struct = actor ? new J.Chain([merc, actor]) : null;
    this.views.forEach(function (v) {
      v.setStruct(struct);
      var f = v.field();
      // Skill names depend on the save (JA2 1.0x skills or 1.13 traits).
      if (f && f.names) { v.setOptions(f.names.options()); }
      v.refresh();
      v.setEnabled(editable && !!f);
    });
    var hasSkill3 = !!struct && struct.has('Skill3');
    this.$skill3Row.toggle(hasSkill3);
    $('.app').toggleClass('tall', hasSkill3);

    // +1 / +10 only for JA2 1.0x saves (save versions up to 99).
    var classic = !!actor && actor.version <= 99;
    this.bumpButtons.forEach(function ($b) {
      $b.toggle(classic).prop('disabled', !editable);
    });
  };

  /** Highest value a skill reaches in the game. */
  var SKILL_MAX = 100;

  /**
   * Raises a skill by `amount` (not above SKILL_MAX) and its increase, the
   * value in brackets, by the same number of points.
   */
  StatPanel.prototype.bump = function (field, incField, amount) {
    var stat = this.viewByField[field];
    var inc = this.viewByField[incField];
    if (!stat.field() || !inc.field()) { return; }
    var current = stat.struct.getInt(field);
    var gain = Math.min(SKILL_MAX, current + amount) - current;
    if (gain <= 0) { return; }
    stat.setValue(current + gain);
    inc.setValue(Math.min(inc.field().max, inc.struct.getInt(incField) + gain));
  };

  // ===========================================================================
  // Item detail panel
  // ===========================================================================

  function categoryIn(categories) {
    return function (ex) { return categories.indexOf(ex.category) !== -1; };
  }

  /** Items accepted by the restricted inventory slots (others take anything). */
  var SLOT_FILTERS = {};
  SLOT_FILTERS[M.HELMET] = categoryIn([CAT.HELMET]);
  SLOT_FILTERS[M.BODY_ARMOR] = categoryIn([CAT.BODY_ARMOR]);
  SLOT_FILTERS[M.LEG_ARMOR] = categoryIn([CAT.LEG_ARMOR]);
  SLOT_FILTERS[M.HEADGEAR_1] = categoryIn([CAT.HEAD_GEAR]);
  SLOT_FILTERS[M.HEADGEAR_2] = categoryIn([CAT.HEAD_GEAR]);
  SLOT_FILTERS[M.RIGHT_HAND] = function (ex) { return ex.handWeapon; };

  var WEAPON_ATTACHMENT_CATS = [CAT.WEAPON_ATTACHMENT, CAT.GRENADE, CAT.DETONATOR];
  var ARMOR_ATTACHMENT_CATS = [CAT.ARMOR_ATTACHMENT];

  function ItemDetailPanel($root, onChanged) {
    var self = this;
    this.onChanged = onChanged;
    this.item = null;
    this.slot = -1;
    this.editable = false;
    this.views = [];
    this.itemPctViews = [];
    this.attachmentIdViews = [];
    this.attachmentPctViews = [];
    this.$ammoLabels = $();
    this.$attachmentLabels = $();

    var $table = $('<table class="grid detail-grid">');
    $table.append('<colgroup><col class="c-label"><col class="c-cell"><col class="c-cell"><col class="c-cell">' +
      '<col class="c-cell"><col class="c-cell"><col class="c-cell"><col class="c-pct"><col></colgroup>');
    var $body = $('<tbody>').appendTo($table);

    function add(v) {
      self.views.push(v);
      v.onChange(function (src, oldV, newV) { self.dataChanged(src, oldV, newV); });
      return v;
    }
    function num(field) { return add(new InputView(field, 'num')); }
    function choice(field, list) { return add(new ChoiceView(field, 'item', list)); }

    // Item
    var $l = td('lbl', 'Item');
    this.idView = choice('Item ID', J.ITEM_LIST);
    $('<tr>').append($l, td(null).attr('colspan', 6).append(this.idView.$el), spacer(2)).appendTo($body);

    // Number of Items
    $l = td('lbl', 'Number of Items');
    this.quantityView = num('Quantity');
    $('<tr>').append($l, td(null).append(this.quantityView.$el), spacer(7)).appendTo($body);

    // Item % x 6
    this.$itemPctLabel = td('lbl', 'Item %');
    var $row = $('<tr>').append(this.$itemPctLabel);
    for (var i = 0; i < 6; ++i) {
      var pv = num('Item ' + (i + 1) + ' %');
      this.itemPctViews.push(pv);
      $row.append(td(null).append(pv.$el));
    }
    $row.append(spacer(2)).appendTo($body);

    // Ammo
    $l = td('lbl', 'Ammo');
    this.$ammoLabels = this.$ammoLabels.add($l);
    this.ammoIdView = choice('Ammo ID', J.AMMO_LIST);
    $('<tr>').append($l, td(null).attr('colspan', 6).append(this.ammoIdView.$el), spacer(2)).appendTo($body);

    function ammoRow(title, field) {
      var $lbl = td('lbl', title);
      self.$ammoLabels = self.$ammoLabels.add($lbl);
      var v = num(field);
      $('<tr>').append($lbl, td(null).append(v.$el), spacer(7)).appendTo($body);
      return v;
    }
    this.ammoQuantityView = ammoRow('Number of Rounds', 'Ammo Quantity');
    this.ammoVarietyView = ammoRow('Ammo Variety', 'Ammo Variety');
    this.ammoPctView = ammoRow('Ammo %', 'Ammo %');

    // Attachments 1-4 (the item structure has exactly four slots)
    for (var k = 0; k < 4; ++k) {
      var name = 'Attachment ' + (k + 1);
      var $al = td('lbl', name);
      var $sign = td('pctsign sep', '%');
      this.$attachmentLabels = this.$attachmentLabels.add($al).add($sign);
      var idv = choice(name + ' ID', J.ATTACHMENT_LIST);
      var pctv = num(name + ' %');
      this.attachmentIdViews.push(idv);
      this.attachmentPctViews.push(pctv);
      $('<tr>').append($al, td(null).attr('colspan', 6).append(idv.$el), td('pct').append(pctv.$el), $sign)
        .appendTo($body);
    }

    // Weight
    $l = td('lbl', 'Weight (x 0.1 kg)');
    this.weightView = num('Weight');
    $('<tr>').append($l, td(null).append(this.weightView.$el), spacer(7)).appendTo($body);

    // Money
    this.$moneyLabel = td('lbl', 'Money Value');
    this.moneyValueView = num('Money Value');
    $('<tr>').append(this.$moneyLabel, td(null).append(this.moneyValueView.$el), spacer(7)).appendTo($body);

    this.ammoViews = [this.ammoIdView, this.ammoQuantityView, this.ammoVarietyView, this.ammoPctView];

    /** Set by the owner: function (slot, itemId) -> error message or null. */
    this.checkItem = null;
    this.idView.validate = function (oldId, newId) {
      var error = self.checkItem ? self.checkItem(self.slot, newId) : null;
      if (error) { messageDialog(error); }
      return !error;
    };

    $root.append($table);
    this.setItem(null, -1, false);
  }

  ItemDetailPanel.prototype.setItem = function (item, slot, editable) {
    this.item = item;
    this.slot = slot;
    this.editable = editable;
    this.views.forEach(function (v) { v.setStruct(item); });
    this.updateOptions();
    this.views.forEach(function (v) { v.refresh(); });
    this.setEnabledAll();
  };

  /** Rebuilds the drop-down lists so they only offer items that fit. */
  ItemDetailPanel.prototype.updateOptions = function () {
    var item = this.item;
    var currentId = item ? item.getInt('Item ID') : 0;
    var allowed = SLOT_FILTERS[this.slot] || null;
    this.idView.setOptions(J.ITEM_LIST.filter(function (ex) {
      return ex.id === 0 || ex.id === currentId || !allowed || allowed(ex);
    }));

    var ex = J.exemplar(currentId);
    var category = ex ? ex.category : -1;

    var currentAmmo = item ? item.getInt('Ammo ID') : 0;
    this.ammoIdView.setOptions(J.AMMO_LIST.filter(function (a) {
      if (category !== CAT.WEAPON || a.id === 0) { return true; }
      return a.id === currentAmmo || ex.compatibleAmmoIds.indexOf(a.id) !== -1;
    }));

    var attachmentCats = category === CAT.WEAPON ? WEAPON_ATTACHMENT_CATS :
      category === CAT.BODY_ARMOR ? ARMOR_ATTACHMENT_CATS : null;
    this.attachmentIdViews.forEach(function (v, k) {
      var current = item ? item.getInt('Attachment ' + (k + 1) + ' ID') : 0;
      v.setOptions(J.ATTACHMENT_LIST.filter(function (a) {
        return a.id === 0 || a.id === current || !attachmentCats || attachmentCats.indexOf(a.category) !== -1;
      }));
    });

    [this.idView, this.ammoIdView].concat(this.attachmentIdViews).forEach(function (v) { v.refresh(); });
  };

  /** Enables the fields that make sense for the current item type. */
  ItemDetailPanel.prototype.setEnabledAll = function () {
    var item = this.item;
    var editable = this.editable && !!item;
    var ex = item ? item.exemplar() : null;
    var category = ex ? ex.category : -1;
    var ammoOn = category === CAT.WEAPON;
    var attachmentsOn = category === CAT.WEAPON || category === CAT.BODY_ARMOR;
    var moneyOn = category === CAT.MONEY;
    var quantity = item ? item.getInt('Quantity') : 0;

    [this.idView, this.quantityView, this.weightView].forEach(function (v) { v.setEnabled(editable); });

    // Labels are greyed by item type only while an item is shown.
    this.ammoViews.forEach(function (v) {
      v.setEnabled(editable && ammoOn);
      v.setMasked(!ammoOn);
    });
    this.$ammoLabels.toggleClass('disabled', !!item && !ammoOn);

    this.attachmentIdViews.concat(this.attachmentPctViews).forEach(function (v) {
      v.setEnabled(editable && attachmentsOn);
    });
    this.$attachmentLabels.toggleClass('disabled', !!item && !attachmentsOn);

    this.moneyValueView.setEnabled(editable && moneyOn);
    this.moneyValueView.setMasked(!moneyOn);
    this.$moneyLabel.toggleClass('disabled', !!item && !moneyOn);

    this.itemPctViews.forEach(function (v, idx) {
      var on = !!item && idx < quantity;
      v.setEnabled(editable && on);
      v.setMasked(!on);
    });
    this.$itemPctLabel.toggleClass('disabled', !!item && quantity === 0);
    this.$itemPctLabel.text(category === CAT.AMMO ? 'Number of Rounds' : 'Item %');
  };

  /** Port of ItemDetailPanel.dataChanged: fills in sensible defaults. */
  ItemDetailPanel.prototype.dataChanged = function (view, oldValue, newValue) {
    var item = this.item;
    if (!item) { return; }
    var ex;

    if (view === this.idView) {
      this.updateOptions();
      // From None to something: count 1, 100%. To None: count 0, 0%.
      if (oldValue === 0 && newValue !== 0) {
        this.quantityView.setValue(1);
        this.itemPctViews[0].setValue(100);
      } else if (newValue === 0) {
        this.quantityView.setValue(0);
        this.itemPctViews[0].setValue(0);
      }
      ex = item.exemplar();
      if (ex && ex.category === CAT.WEAPON) {
        this.quantityView.setValue(1);
        this.loadDefaultAmmo(ex);
      } else if (ex && ex.category === CAT.AMMO) {
        var quantity = Math.min(item.getInt('Quantity'), this.itemPctViews.length);
        for (var i = 0; i < quantity; ++i) { this.itemPctViews[i].setValue(ex.ammoCapacity); }
      }
      this.setEnabledAll();
    } else if (view === this.ammoIdView) {
      // New magazine type: set its variety and fill it up.
      if (newValue !== 0 && newValue !== oldValue) {
        ex = J.exemplar(item.getInt('Ammo ID'));
        if (ex) {
          this.ammoVarietyView.setValue(ex.ammoVariety);
          this.ammoQuantityView.setValue(ex.ammoCapacity);
          this.ammoPctView.setValue(100);
        }
      }
      this.updateOptions();
    } else if (view === this.quantityView) {
      this.setEnabledAll();
    } else {
      var k = this.attachmentIdViews.indexOf(view);
      if (k !== -1) {
        if (oldValue === 0 && newValue !== 0) { this.attachmentPctViews[k].setValue(100); }
        this.updateOptions();
      }
    }

    this.onChanged();
  };

  /**
   * A weapon whose loaded magazine is of another calibre gets its default
   * magazine, full, the way the game creates a new gun.
   */
  ItemDetailPanel.prototype.loadDefaultAmmo = function (weapon) {
    if (!weapon.defaultAmmoId) { return; }
    if (weapon.compatibleAmmoIds.indexOf(this.item.getInt('Ammo ID')) !== -1) { return; }
    this.ammoIdView.setValue(weapon.defaultAmmoId);
  };

  // ===========================================================================
  // Item panel (19 inventory slots + detail panel)
  // ===========================================================================

  var SLOT_ROWS = [
    [M.HEADGEAR_1, null, M.HELMET],
    [M.HEADGEAR_2, null, M.BODY_ARMOR],
    [M.RIGHT_HAND, null, M.LEG_ARMOR],
    [M.LEFT_HAND],
    [M.BACKPACK_1_1, M.BACKPACK_1_2, M.BACKPACK_1_3],
    [M.BACKPACK_2_1, M.BACKPACK_2_2, M.BACKPACK_2_3],
    [M.BACKPACK_3_1, M.BACKPACK_3_2, M.BACKPACK_3_3],
    [M.BACKPACK_4_1, M.BACKPACK_4_2, M.BACKPACK_4_3]
  ];

  var SLOT_NAMES = {};
  SLOT_NAMES[M.HELMET] = 'Helmet';
  SLOT_NAMES[M.BODY_ARMOR] = 'Body armor';
  SLOT_NAMES[M.LEG_ARMOR] = 'Leg armor';
  SLOT_NAMES[M.HEADGEAR_1] = 'Head gear 1';
  SLOT_NAMES[M.HEADGEAR_2] = 'Head gear 2';
  SLOT_NAMES[M.RIGHT_HAND] = 'Right hand';
  SLOT_NAMES[M.LEFT_HAND] = 'Left hand';

  function ItemPanel($root, onChanged) {
    var self = this;
    this.onChanged = onChanged;
    this.merc = null;
    this.mode = 'none';
    this.current = SLOT_ROWS[0][0];
    this.buttons = {};

    var $slots = $('<div class="slots">');
    SLOT_ROWS.forEach(function (row, r) {
      row.forEach(function (slot, c) {
        if (slot === null) { return; }
        var $b = $('<button type="button" class="btn">')
          .text('None')
          .css({ gridRow: String(r + 1), gridColumn: String(c + 1) })
          .on('click', function () { self.selectSlot(slot); });
        self.buttons[slot] = $b;
        $slots.append($b);
      });
    });
    // Backpack slot names follow the grid position.
    SLOT_ROWS.slice(4).forEach(function (row, r) {
      row.forEach(function (slot, c) { SLOT_NAMES[slot] = 'Backpack ' + (r + 1) + '-' + (c + 1); });
    });

    // Full Dress: in the free cell under the leg armour slot.
    this.$fullDress = $('<button type="button" class="btn action full-dress">')
      .text('Full Dress')
      .attr('title', 'Put on Coated Spectra Helmet, Coated Spectra Vest with 4 Ceramic Plates, ' +
        'Coated Spectra Leggings, Night Vision Goggles and Extended Ear (replaces the items in those slots)')
      .css({ gridRow: '4', gridColumn: '3' })
      .on('click', function () { self.fullDress(); });
    // Add LAW / Add rifle: in the free middle cells next to Full Dress.
    this.$addLaw = $('<button type="button" class="btn action add-law">').text('Add LAW')
      .attr('title', 'Create 6 LAWs in one slot: the first empty slot, searching from the last one')
      .css({ gridRow: '3', gridColumn: '2' })
      .on('click', function () { self.addQuickItem('law'); });
    this.$addRifle = $('<button type="button" class="btn action add-rifle">').text('Add rifle')
      .attr('title', 'Create an Auto Rocket Rifle with 255 HEAP minirockets: the first empty slot, searching from the last one')
      .css({ gridRow: '4', gridColumn: '2' })
      .on('click', function () { self.addQuickItem('rifle'); });
    $slots.append(this.$fullDress, this.$addLaw, this.$addRifle);

    this.$note = $('<p class="item-note">').text('Item editing is not supported for JA2 1.13 save games.');
    var $detail = $('<div class="detail">');
    $root.append($slots, this.$note, $detail);

    this.detail = new ItemDetailPanel($detail, function () {
      self.refreshButtons();
      self.onChanged();
    });
    this.detail.checkItem = function (slot, id) { return self.checkItem(slot, id); };
    this.setActor(null, 'none');
  }

  /**
   * @param mode 'edit' (team member), 'view' (read-only soldier),
   *             'unsupported' (1.13 save) or 'none' (no soldier record)
   */
  ItemPanel.prototype.setActor = function (merc, mode) {
    this.merc = merc && merc.items ? merc : null;
    this.mode = mode;
    this.refreshButtons();
    this.$note.toggleClass('shown', mode === 'unsupported');
    [this.$fullDress, this.$addLaw, this.$addRifle].forEach(function ($b) {
      $b.toggle(mode !== 'unsupported').prop('disabled', mode !== 'edit' || !this.merc);
    }, this);
    this.selectSlot(SLOT_ROWS[0][0]);
  };

  /**
   * Creates a ready-made item (J.QUICK_ITEMS) in the first empty slot,
   * searching from the last slot down. Slots that would not accept the item
   * under the slot rules (armour and head gear slots, hands blocked by a
   * two-handed weapon) are skipped.
   */
  ItemPanel.prototype.addQuickItem = function (key) {
    if (this.mode !== 'edit' || !this.merc) { return; }
    var quick = J.QUICK_ITEMS[key];
    var ex = J.exemplar(quick.id);
    var slot = -1;
    for (var s = this.merc.items.length - 1; s >= 0; --s) {
      if (this.merc.items[s].getInt('Item ID') !== 0) { continue; }
      var filter = SLOT_FILTERS[s];
      if (filter && !filter(ex)) { continue; }
      if (s === M.LEFT_HAND && this.twoHandedInRightHand()) { continue; }
      if (this.checkItem(s, quick.id)) { continue; }
      slot = s;
      break;
    }
    if (slot === -1) {
      messageDialog('No free slot for ' + quick.label + '.');
      return;
    }
    quick.make(this.merc.items[slot]);
    this.refreshButtons();
    this.selectSlot(slot);
    this.onChanged();
  };

  /** Puts on the Full Dress set, replacing what is in those slots. */
  ItemPanel.prototype.fullDress = function () {
    if (this.mode !== 'edit' || !this.merc) { return; }
    this.merc.fullDress();
    this.refreshButtons();
    this.selectSlot(J.FULL_DRESS[1].slot);   // show the vest with its plates
    this.onChanged();
  };

  ItemPanel.prototype.itemAt = function (slot) {
    return this.merc ? this.merc.items[slot] : null;
  };

  /** A two-handed weapon in the right hand blocks the left hand. */
  ItemPanel.prototype.twoHandedInRightHand = function () {
    var right = this.itemAt(M.RIGHT_HAND);
    var ex = right ? right.exemplar() : null;
    return ex && ex.twoHanded ? ex : null;
  };

  /** Veto for item changes: error message, or null when allowed. */
  ItemPanel.prototype.checkItem = function (slot, id) {
    var ex = J.exemplar(id);
    var left = this.itemAt(M.LEFT_HAND);
    if (slot === M.RIGHT_HAND && ex && ex.twoHanded && left && left.getInt('Item ID') !== 0) {
      return ex.name + ' is a two-handed weapon.\nEmpty the left hand first.';
    }
    return null;
  };

  ItemPanel.prototype.refreshButtons = function () {
    var browsable = !!this.merc;
    var blocker = this.twoHandedInRightHand();
    for (var key in this.buttons) {
      if (Object.prototype.hasOwnProperty.call(this.buttons, key)) {
        var slot = +key;
        this.buttons[key].prop('disabled', !browsable || (slot === M.LEFT_HAND && !!blocker));
        this.refreshButton(slot, slot === M.LEFT_HAND ? blocker : null);
      }
    }
  };

  ItemPanel.prototype.refreshButton = function (slot, blocker) {
    var item = this.itemAt(slot);
    var label = 'None';
    if (item) {
      var ex = item.exemplar();
      label = ex ? ex.name : 'Unknown';
    }
    var title = SLOT_NAMES[slot] + ': ' + label;
    if (blocker) { title = SLOT_NAMES[slot] + ': blocked by ' + blocker.name + ' (two-handed)'; }
    this.buttons[slot].text(label).attr('title', title);
  };

  ItemPanel.prototype.selectSlot = function (slot) {
    this.current = slot;
    for (var s in this.buttons) {
      if (Object.prototype.hasOwnProperty.call(this.buttons, s)) {
        this.buttons[s].toggleClass('selected', !!this.merc && +s === slot);
      }
    }
    this.detail.setItem(this.itemAt(slot), slot, this.mode === 'edit');
  };

  // ===========================================================================
  // Dialogs (OptionDialog, JapeAbout)
  // ===========================================================================

  var OPTION = { YES: 'yes', NO: 'no', CANCEL: 'cancel', OK: 'ok', CLOSED: 'closed' };
  var dialogOpen = false;

  /**
   * @param opts {title, lines[], buttons[{label, value}], centered}
   * @return Promise resolving to the chosen value or OPTION.CLOSED.
   */
  function showDialog(opts) {
    return new Promise(function (resolve) {
      var previousFocus = document.activeElement;
      var $overlay = $('<div class="modal-overlay">');
      var titleId = 'dlg-title-' + Date.now();
      var $dialog = $('<div class="dialog" role="dialog" aria-modal="true">').attr('aria-labelledby', titleId);
      var $close = $('<button type="button" class="dialog-close" aria-label="Close">').text('✕');
      $dialog.append($('<div class="dialog-title">').append($('<span>').attr('id', titleId).text(opts.title), $close));

      var $text = $('<div class="dialog-text">').toggleClass('centered', !!opts.centered);
      opts.lines.forEach(function (line) { $text.append($('<p>').text(line)); });
      $dialog.append($text);

      var $buttons = $('<div class="dialog-buttons">');
      opts.buttons.forEach(function (b) {
        $('<button type="button" class="btn">').text(b.label)
          .on('click', function () { finish(b.value); })
          .appendTo($buttons);
      });
      $dialog.append($buttons);
      $overlay.append($dialog).appendTo(document.body);
      dialogOpen = true;

      function finish(value) {
        $overlay.remove();
        dialogOpen = false;
        if (previousFocus && document.contains(previousFocus)) { previousFocus.focus(); }
        resolve(value);
      }

      $close.on('click', function () { finish(OPTION.CLOSED); });
      $overlay.on('keydown', function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(OPTION.CLOSED);
        } else if (e.key === 'Tab') {
          // Keep focus inside the dialog.
          var $f = $dialog.find('button');
          var idx = $f.index(document.activeElement);
          var next = e.shiftKey ? (idx <= 0 ? $f.length - 1 : idx - 1) : (idx + 1) % $f.length;
          e.preventDefault();
          $f[next].focus();
        }
      });
      $buttons.find('button')[0].focus();
    });
  }

  function messageDialog(message) {
    return showDialog({ title: 'JAPE', lines: message.split('\n'), buttons: [{ label: 'OK', value: OPTION.OK }] });
  }

  function confirmDialog(message) {
    return showDialog({
      title: 'JAPE',
      lines: message.split('\n'),
      buttons: [
        { label: 'Yes', value: OPTION.YES },
        { label: 'No', value: OPTION.NO },
        { label: 'Cancel', value: OPTION.CANCEL }
      ]
    });
  }

  function aboutDialog() {
    return showDialog({
      title: 'About JAPE',
      centered: true,
      lines: [
        'JAPE: A Jagged Alliance 2 Save Game Editor',
        'Version 0.41 (JavaScript port)',
        'Copyright (c) 2008  Douglas Greiman',
        'http://www.duggelz.org/'
      ],
      buttons: [{ label: 'OK', value: OPTION.OK }]
    });
  }

  // ===========================================================================
  // File access: File System Access API with download fallback
  // ===========================================================================

  var canOverwrite = typeof window.showOpenFilePicker === 'function';
  var PICKER_TYPES = [{
    description: 'Jagged Alliance 2 save game',
    accept: { 'application/octet-stream': ['.sav'] }
  }];

  function isAbort(e) { return e && e.name === 'AbortError'; }

  /** @return Promise<{file, handle}|null> */
  function pickFile() {
    if (canOverwrite) {
      return window.showOpenFilePicker({ types: PICKER_TYPES, multiple: false }).then(function (handles) {
        return handles[0].getFile().then(function (file) { return { file: file, handle: handles[0] }; });
      }, function (e) {
        if (isAbort(e)) { return null; }
        throw e;
      });
    }
    return new Promise(function (resolve) {
      var $input = $('#file-input');
      $input.off('.pick').val('');
      $input.on('change.pick', function () {
        $input.off('.pick');
        var file = this.files && this.files[0];
        resolve(file ? { file: file, handle: null } : null);
      });
      $input.on('cancel.pick', function () {
        $input.off('.pick');
        resolve(null);
      });
      $input[0].click();
    });
  }

  function writeToHandle(handle, bytes) {
    var permission = handle.queryPermission ?
      handle.queryPermission({ mode: 'readwrite' }).then(function (state) {
        if (state === 'granted') { return state; }
        return handle.requestPermission({ mode: 'readwrite' });
      }) : Promise.resolve('granted');
    return permission.then(function (state) {
      if (state !== 'granted') { throw new Error('Permission to write the file was denied.'); }
      return handle.createWritable();
    }).then(function (writable) {
      return writable.write(bytes).then(function () { return writable.close(); });
    });
  }

  function download(bytes, name) {
    var url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    var $a = $('<a>').attr({ href: url, download: name }).appendTo(document.body);
    $a[0].click();
    $a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  // ===========================================================================
  // JA2 1.13 v5 inventory (replace item X with item Y)
  // ===========================================================================

  function Inventory113Panel($root, onChanged) {
    var self = this;
    this.onChanged = onChanged;
    this.inv = null;
    this.editable = false;
    this.index = -1;

    this.$el = $('<div class="inv113">').hide().appendTo($root);
    this.$list = $('<div class="listbox inv-list" role="listbox" tabindex="0" aria-label="Inventory">')
      .appendTo(this.$el);

    var $table = $('<table class="grid detail-grid detail113">').appendTo(this.$el);
    $table.append('<colgroup><col class="c-label"><col></colgroup>');
    function row(label, $value) {
      $('<tr>').append(td('lbl', label), td(null).append($value)).appendTo($table);
      return $value;
    }
    this.$name = row('Item', $('<span class="value">'));
    this.$status = row('Status', $('<span class="value">'));
    this.$select = row('Replace with', $('<select class="field item" aria-label="Replace with">'));
    this.$ammo = row('Ammo', $('<span class="value">'));
    this.$attachments = row('Attachments', $('<span class="value">'));
    this.$note = $('<p class="inv-note">').appendTo(this.$el);

    this.$list.on('mousedown', '.opt', function () { self.selectSlot(+$(this).data('slot')); });
    this.$list.on('keydown', function (e) {
      var $rows = self.$list.find('.opt');
      var pos = $rows.index($rows.filter('.selected'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        pos = e.key === 'ArrowDown' ? Math.min($rows.length - 1, pos + 1) : Math.max(0, pos - 1);
        if ($rows[pos]) { self.selectSlot(+$($rows[pos]).data('slot')); }
      }
    });
    this.$select.on('change', function () { self.apply(parseInt(self.$select.val(), 10)); });
  }

  Inventory113Panel.prototype.show = function (visible) { this.$el.toggle(visible); };

  /** @param merc soldier record or null; editable only for the player's team */
  Inventory113Panel.prototype.setSoldier = function (merc, game, editable) {
    var db = J.Items113.db();
    this.inv = merc && db ? new J.Items113.Inventory(merc, game, db) : null;
    this.editable = editable;
    this.index = -1;
    this.renderList();
    var first = this.inv ? this.inv.slots()[0] : null;
    this.selectSlot(first ? first.index : -1);
    if (!this.inv) {
      this.$note.text(merc ? 'Item data is not available.' : 'No soldier record: this character is not in the game world.');
    }
  };

  Inventory113Panel.prototype.renderList = function () {
    var self = this;
    this.$list.empty();
    if (!this.inv) { return; }
    this.inv.slots().forEach(function (s) {
      $('<div class="opt" role="option">')
        .data('slot', s.index)
        .attr('title', s.item ? s.item.longName : s.name)
        .append($('<span class="slot">').text(s.slotName),
          $('<span class="name">').text(s.name + (s.number > 1 ? ' ×' + s.number : '')))
        .toggleClass('selected', s.index === self.index)
        .appendTo(self.$list);
    });
  };

  Inventory113Panel.prototype.selectSlot = function (index) {
    this.index = index;
    this.$list.find('.opt').each(function () {
      $(this).toggleClass('selected', +$(this).data('slot') === index);
    });
    var info = this.inv && index >= 0 ? this.inv.slot(index) : null;
    this.$select.empty().prop('disabled', true);
    if (!info) {
      this.$name.text('');
      this.$status.text('');
      this.$ammo.text('');
      this.$attachments.text('');
      this.$note.text(this.inv ? 'Empty inventory.' : '');
      return;
    }
    this.$name.text(info.name + (info.number > 1 ? ' ×' + info.number : '') + '  (#' + info.id + ')')
      .attr('title', info.item ? info.item.longName : '');
    this.$status.text(info.status + '%');
    this.$ammo.text(info.ammo ? info.ammo.name + ', ' + info.ammo.shots + ' rounds (' + info.ammo.calibre +
      ', ' + info.ammo.type + ')' : '—');
    this.$attachments.text(info.attachments.length ? info.attachments.join(', ') : 'none');

    var opts = this.inv.options(index);
    if (opts.reason) {
      $('<option>').val(String(info.id)).text(info.name).appendTo(this.$select);
      this.$note.text(opts.reason);
      return;
    }
    var frag = document.createDocumentFragment();
    opts.items.forEach(function (it) {
      frag.appendChild($('<option>').val(String(it.id)).text(it.name).attr('title', it.longName)[0]);
    });
    this.$select.append(frag).val(String(info.id)).prop('disabled', !this.editable);
    this.$note.text(this.editable ?
      'Choose another ' + opts.group + '. Attachments are removed; the new item comes with its factory attachments.' :
      'Read-only: this character is not on your team.');
  };

  Inventory113Panel.prototype.apply = function (newId) {
    var info = this.inv.slot(this.index);
    if (!info || newId === info.id) { return; }
    var error = this.inv.check(this.index, newId);
    if (error) {
      this.$select.val(String(info.id));
      messageDialog(error);
      return;
    }
    var summary = this.inv.replace(this.index, newId);
    this.renderList();
    this.selectSlot(this.index);
    var notes = ['Replaced ' + info.name + ' with ' + J.Items113.db().name(newId) + '.'];
    if (summary.removed.length) { notes.push('Removed: ' + summary.removed.join(', ') + '.'); }
    if (summary.added.length) { notes.push('Factory attachments: ' + summary.added.join(', ') + '.'); }
    if (summary.ammo) { notes.push('Ammo: ' + summary.ammo + '.'); }
    this.$note.text(notes.join(' '));
    this.onChanged();
  };

  // ===========================================================================
  // Application (JapeFrame)
  // ===========================================================================

  function App() {
    var self = this;
    this.game = null;
    this.handle = null;
    this.fileName = null;
    this.modified = false;
    this.index = -1;

    this.$list = $('#actor-list');
    this.statPanel = new StatPanel($('#stat-panel'), function (field) { self.dataChanged(field); });
    this.$classicItems = $('<div class="classic-items">').appendTo('#item-panel');
    this.itemPanel = new ItemPanel(this.$classicItems, function () { self.dataChanged(null); });
    this.inv113 = new Inventory113Panel($('#item-panel'), function () { self.dataChanged(null); });

    this.bindMenus();
    this.bindList();
    this.bindKeys();
    $(window).on('beforeunload', function (e) {
      if (self.modified) {
        e.preventDefault();
        e.originalEvent.returnValue = '';
      }
    });

    this.populateActorList();
    this.updateChrome();
  }

  // ---- menus ----------------------------------------------------------------------

  App.prototype.bindMenus = function () {
    var self = this;
    var $menus = $('.menubar .menu');

    function closeAll() {
      $menus.removeClass('open').find('.menu-title').attr('aria-expanded', 'false');
    }
    function open($menu, focusFirst) {
      closeAll();
      $menu.addClass('open').find('.menu-title').attr('aria-expanded', 'true');
      if (focusFirst) { $menu.find('.menu-popup button:not(:disabled)').first().trigger('focus'); }
    }

    $menus.each(function () {
      var $menu = $(this);
      $menu.find('.menu-title').on('click', function (e) {
        var wasOpen = $menu.hasClass('open');
        closeAll();
        if (!wasOpen) { open($menu, e.detail === 0); }
      }).on('mouseenter', function () {
        if ($menus.hasClass('open') && !$menu.hasClass('open')) { open($menu, false); }
      });
    });

    $('.menu-popup').on('keydown', function (e) {
      var $items = $(this).find('button:not(:disabled)');
      var idx = $items.index(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var next = e.key === 'ArrowDown' ? (idx + 1) % $items.length : (idx <= 0 ? $items.length - 1 : idx - 1);
        $items.eq(next).trigger('focus');
      } else if (e.key === 'Escape') {
        var $title = $(this).closest('.menu').find('.menu-title');
        closeAll();
        $title.trigger('focus');
      }
    });

    $('.menu-popup button').on('click', function () {
      var cmd = $(this).data('cmd');
      closeAll();
      self.command(cmd);
    });

    $(document).on('mousedown', function (e) {
      if (!$(e.target).closest('.menubar').length) { closeAll(); }
    });
  };

  App.prototype.command = function (cmd) {
    switch (cmd) {
      case 'open': return this.doOpen();
      case 'save': return this.doSave();
      case 'saveAs': return this.doSaveAs();
      case 'close': return this.doClose();
      case 'about': return aboutDialog();
    }
    return null;
  };

  App.prototype.bindKeys = function () {
    var self = this;
    $(document).on('keydown', function (e) {
      if (dialogOpen || !(e.ctrlKey || e.metaKey) || e.altKey) { return; }
      var key = e.key.toLowerCase();
      if (key === 'o') {
        e.preventDefault();
        self.doOpen();
      } else if (key === 's' && self.game) {
        e.preventDefault();
        if (e.shiftKey) { self.doSaveAs(); } else { self.doSave(); }
      }
    });
  };

  // ---- character list (AWT List) ---------------------------------------------------------

  App.prototype.bindList = function () {
    var self = this;
    this.$list.on('mousedown', '.opt', function () {
      self.selectActor(+$(this).data('index'));
    });
    this.$list.on('keydown', function (e) {
      if (!self.game) { return; }
      var count = self.game.actors.length;
      var page = Math.max(1, Math.floor(self.$list.innerHeight() / 13) - 1);
      var i = self.index;
      switch (e.key) {
        case 'ArrowDown': i = Math.min(count - 1, i + 1); break;
        case 'ArrowUp': i = Math.max(0, i - 1); break;
        case 'PageDown': i = Math.min(count - 1, i + page); break;
        case 'PageUp': i = Math.max(0, i - page); break;
        case 'Home': i = 0; break;
        case 'End': i = count - 1; break;
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            i = self.findByLetter(e.key);
            if (i === -1) { return; }
          } else {
            return;
          }
      }
      e.preventDefault();
      if (i !== self.index) { self.selectActor(i); }
    });
  };

  /** Next character whose nickname starts with the letter (type-ahead). */
  App.prototype.findByLetter = function (letter) {
    var actors = this.game.actors;
    letter = letter.toLowerCase();
    for (var step = 1; step <= actors.length; ++step) {
      var i = (this.index + step) % actors.length;
      if (actors[i].get('Nickname').toLowerCase().indexOf(letter) === 0) { return i; }
    }
    return -1;
  };

  App.prototype.actorLabel = function (i) {
    var merc = this.game.actorMercs[i];
    return (merc && merc.isOnPlayerTeam() ? '*' : '') + this.game.actors[i].get('Nickname');
  };

  App.prototype.populateActorList = function () {
    var self = this;
    this.$list.empty().removeAttr('aria-activedescendant');
    this.index = -1;
    if (!this.game) {
      this.setActor(null, null);
      return;
    }
    var frag = document.createDocumentFragment();
    this.game.actors.forEach(function (actor, i) {
      frag.appendChild($('<div class="opt" role="option" aria-selected="false">')
        .attr({ id: 'actor-' + i, title: actor.get('Name') })
        .data('index', i)
        .text(self.actorLabel(i))[0]);
    });
    this.$list.append(frag);
  };

  App.prototype.selectActor = function (i) {
    if (!this.game || i < 0 || i >= this.game.actors.length) { return; }
    this.$list.find('.opt.selected').removeClass('selected').attr('aria-selected', 'false');
    var $opt = $('#actor-' + i).addClass('selected').attr('aria-selected', 'true');
    this.$list.attr('aria-activedescendant', 'actor-' + i);
    // Scroll only the list (scrollIntoView could also scroll the page).
    var list = this.$list[0];
    var top = $opt[0].offsetTop;
    var bottom = top + $opt[0].offsetHeight;
    if (top < list.scrollTop) {
      list.scrollTop = top;
    } else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
    this.index = i;
    this.setActor(this.game.actors[i], this.game.actorMercs[i]);
  };

  App.prototype.setActor = function (actor, merc) {
    var owned = !!merc && merc.isOnPlayerTeam();
    this.statPanel.setActor(actor, merc, owned);

    // JA2 1.13 v5 saves get their own inventory panel.
    var v5 = !!this.game && this.game.version === J.SaveGame113.VERSION;
    this.$classicItems.toggle(!v5);
    this.inv113.show(v5);
    if (v5) {
      this.inv113.setSoldier(merc, this.game, owned);
    }

    var mode = 'none';
    if (merc && this.game.version > 99) {
      mode = 'unsupported';
    } else if (merc) {
      mode = owned ? 'edit' : 'view';
    }
    this.itemPanel.setActor(merc, mode);

    var msg = '';
    if (!this.game) {
      msg = 'Use File › Open... to load a Jagged Alliance 2 save game (SavedGames\\SaveGameNN.sav).';
    } else if (actor && !owned) {
      msg = 'Read-only: ' + (actor.get('Nickname') || actor.get('Name') || 'this character') +
        ' is not on your team. Only characters marked * can be edited.';
    }
    $('#status-msg').text(msg);
  };

  // ---- modification state -------------------------------------------------------------

  App.prototype.dataChanged = function (field) {
    if (!this.game) { return; }
    this.setModified(true);
    if (field === 'Nickname' && this.index !== -1) {
      $('#actor-' + this.index).text(this.actorLabel(this.index));
    }
  };

  App.prototype.setModified = function (modified) {
    this.modified = modified;
    this.updateChrome();
  };

  App.prototype.updateChrome = function () {
    var hasGame = !!this.game;
    document.title = 'JAPE' + (hasGame ? ' - ' + this.fileName + (this.modified ? ' *' : '') : '');
    $('[data-cmd="save"], [data-cmd="saveAs"], [data-cmd="close"]').prop('disabled', !hasGame);
    var info = '';
    if (hasGame) {
      info = this.fileName + (this.modified ? ' (modified)' : '') + ' — ' +
        this.game.formatLabel + ' save, version ' + this.game.version;
      if (!canOverwrite) { info += ' — Save downloads a copy'; }
    }
    $('#status-file').text(info);
  };

  // ---- file commands --------------------------------------------------------------------

  App.prototype.doOpen = async function () {
    if (!(await this.doClose())) { return false; }
    var picked;
    try {
      picked = await pickFile();
    } catch (e) {
      await messageDialog('Unable to load file.\n' + (e.message || 'An unknown error occurred.'));
      return false;
    }
    if (!picked) { return false; }
    var bytes;
    try {
      bytes = new Uint8Array(await picked.file.arrayBuffer());
    } catch (e) {
      await messageDialog('Unable to load file.\n' + (e.message || 'An unknown error occurred.'));
      return false;
    }
    return this.openBytes(bytes, picked.file.name, picked.handle);
  };

  /** Loads a save from memory. Also used by the automated UI tests. */
  App.prototype.openBytes = async function (bytes, name, handle) {
    var game;
    try {
      game = J.SaveGame.load(bytes, name);
    } catch (e) {
      var msg;
      if (e instanceof J.EOFError) {
        msg = 'Unable to load file.\nUnexpected end of file reached.';
      } else if (e instanceof J.FormatError) {
        msg = 'Unable to load file.\nThe save game format was not recognized.\n' + e.message;
      } else {
        msg = 'Unable to load file.\n' + (e.message || 'An unknown error occurred.');
      }
      await messageDialog(msg);
      return false;
    }
    this.game = game;
    this.handle = handle || null;
    this.fileName = name;
    this.populateActorList();
    this.selectActor(0);
    this.setModified(false);
    this.$list.trigger('focus');
    return true;
  };

  App.prototype.doSave = async function () {
    if (!this.game) { return true; }
    if (canOverwrite && !this.handle) { return this.doSaveAs(); }
    var bytes = this.game.save();
    try {
      if (this.handle) {
        await writeToHandle(this.handle, bytes);
      } else {
        download(bytes, this.fileName);
      }
    } catch (e) {
      await messageDialog('Unable to save file.\n' + (e.message || 'An unknown error occurred.'));
      return false;
    }
    this.game.commitSaved(bytes);
    this.setModified(false);
    return true;
  };

  App.prototype.doSaveAs = async function () {
    if (!this.game) { return true; }
    if (typeof window.showSaveFilePicker !== 'function') {
      download(this.game.save(), this.fileName);
      this.setModified(false);
      return true;
    }
    var handle;
    try {
      handle = await window.showSaveFilePicker({ suggestedName: this.fileName, types: PICKER_TYPES });
    } catch (e) {
      if (isAbort(e)) { return false; }
      await messageDialog('Unable to save file.\n' + (e.message || 'An unknown error occurred.'));
      return false;
    }
    var bytes = this.game.save();
    try {
      await writeToHandle(handle, bytes);
    } catch (e) {
      await messageDialog('Unable to save file.\n' + (e.message || 'An unknown error occurred.'));
      return false;
    }
    this.handle = handle;
    this.fileName = handle.name;
    this.game.commitSaved(bytes);
    this.setModified(false);
    return true;
  };

  App.prototype.doClose = async function () {
    if (this.game && this.modified) {
      var option = await confirmDialog('The file ' + this.fileName + ' has been modified.\n' +
        'Do you want to save the changes?');
      if (option === OPTION.CANCEL || option === OPTION.CLOSED) { return false; }
      if (option === OPTION.YES && !(await this.doSave())) { return false; }
    }
    this.game = null;
    this.handle = null;
    this.fileName = null;
    this.modified = false;
    this.populateActorList();
    this.updateChrome();
    return true;
  };

  // ---- start ----------------------------------------------------------------------------

  $(function () {
    J.app = new App();
  });
})(jQuery, this.JAPE);
