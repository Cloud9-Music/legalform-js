/**
 * Base ractive engine class
 * @param {object} jmespath
 */
function RactiveLegalFormEngine(jmespath) {
    var self = this;
    var traits = [
        new InitFieldsTrait(),
        new InitExernalFieldsTrait(),
        new InitPreviewSwitchTrait(),
        new OnChangeTrait(),
        new RepeatedStepsTrait(),
        new WizardTrait(),
        new KeypathTypeTrait(),
        new HelperTrait(),
        new FormScrollTrait()
    ];

    initTraits(this, traits);

    /**
     * Wrapper for dom operations with document object
     */
    this.dom = new Dom();

    /**
     * Variant framework handler
     */
    this.variant = null;

    /**
     * Wrapped version of this.el
     */
    this.elBase = null;

    /**
     * Wizard DOM element
     */
    this.elWizard = null;

    /**
     * Form wizard object
     */
    this.wizard = null;

    /**
     * Current locale
     */
    this.locale = 'en_US';

    /**
     * Number of steps in the wizard
     */
    this.stepCount = null;

    /**
     * Validation service
     */
    this.validation = null;

    /**
     * Lib for performing jmespath transformations
     */
    this.jmespath = jmespath;

    /**
     * Object for calculating dynamic computed values
     * @type {RactiveDynamicComputed}
     */
    this.ractiveDynamicComputed = new RactiveDynamicComputed();

    /**
     * Do actions when template is rendered.
     * Executed before oncomplete
     */
    this.onrender = function() {
        if (typeof this.el === 'string') {
            this.el = this.dom.findOne(this.el).element;
        }

        this.elBase = new DomElement(this.el);
        this.elWizard = this.elBase.findOne('.wizard', true);
        this.variant.setWizard(this.elWizard.element);

        this.set(this.getValuesFromOptions());
        this.observe('*', this.onChangeLegalForm.bind(this), {defer: true});
        this.observe('**', this.onChangeLegalFormRecursive.bind(this), {defer: true});
    };

    /**
     * Method that is called when Ractive is complete
     */
    this.oncomplete = function () {
        this.completeLegalForm();
    };

    /**
     * Apply complete for LegalForm
     */
    this.completeLegalForm = function () {
        this.handleChangeDropdown();
        this.handleChangeDate();
        this.initSelect(this.elBase.findAll('select:not([external_source="true"])', true));

        this.initWizard();
        this.variant.init();

        this.initFormScroll();
        this.initDatePicker();
        this.initInputmask();
        this.initPreviewSwitch();
        this.refreshLikerts();

        metaRecursive(this.get('meta'), this.initField.bind(this));

        this.on('complete', function() {
            self.dom.findOne('#doc').trigger('shown.preview');
        })
    };

    /**
     * Get values from options, applying defaults
     *
     * @returns {object}
     */
    this.getValuesFromOptions = function() {
        var ractive = this;

        // default date
        moment.locale(this.locale);
        var today = moment().format("L");
        today.defaultFormat = "L";

        // Set correct defaults for dates
        metaRecursive(this.meta, function(key, meta) {
            if (meta.default === 'today') {
                setByKeyPath(ractive.defaults, key, today);
            } else if (meta.type === "date") {
                setByKeyPath(ractive.defaults, key, "");
            } else if (meta.type === 'expression' && typeof meta.expressionTmpl !== 'undefined') {
                ractive.cacheExpressionTmpl(key, meta.expressionTmpl);
            }
        });

        var globals = {
            vandaag: today,
            today: today,
            currency: '€',
            valuta: '€'
        };

        return cloner.deep.merge({}, this.defaults, this.values, globals, {meta: this.meta}, this.functions);
    };

    /**
     * Get values that should replace ractive values
     */
    this.getRewriteValues = function() {
        var values = {};

        this.elWizard.findAll('[data-picker="date"]').each(function() {
            var input = this.findOne('input');

            var yearly = !!input.attr('yearly');
            if (yearly) return;

            var value = input.element.value;
            var date = moment(value, 'DD-MM-YYYY', true);
            var isoDate = date.utc().format('YYYY-MM-DDTHH:mm:ssZ');

            var name = input.attr('name');
            values[name] = isoDate;
        });

        return values;
    };
};
