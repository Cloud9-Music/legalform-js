
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = LegalFormCalc;
    var ltriToUrl = require('./lib/ltri-to-url');
    var expandCondition = require('./lib/expand-condition');
    var calculationVars = require('./lib/calculation-vars');
    var FormModel = require('./model/form-model');
    var cloner = require('./lib/cloner');
    var dotKey = require('./lib/dot-key');
    var getByKeyPath = dotKey.getByKeyPath;
    var setByKeyPath = dotKey.setByKeyPath;
}

//Calculate form values from definition
function LegalFormCalc() {
    var self = this;
    var computedRegexp = calculationVars.computedRegexp;
    var globals = calculationVars.globals;

    this.model = null;

    /**
     * Calculate form data based on definition
     * @param  {array} definition  Form definition
     * @return {object}
     */
    this.calc = function(definition) {
        self.model = (new FormModel(definition)).getModel();

        return {
            defaults: calcDefaults(definition),
            computed: calcComputed(definition),
            meta: calcMeta(definition)
        }
    }

    /**
     * Calculate default values for form fields
     * @param  {array} definition  Form definition
     * @return {object}
     */
    function calcDefaults(definition) {
        var data = {};

        for (var i = 0; i < definition.length; i++) {
            var step = definition[i];

            Object.keys(step.fields).forEach(function(j) {
                var field = step.fields[j];
                var type = self.model.getFieldType(field);
                var value = self.model.getFieldValue(field);
                var isComputed = typeof(value) === 'string' && value.indexOf('{{') !== -1;

                if (type === 'amount') {
                    addAmountDefaults(data, step.group, field, isComputed);
                } else if (!isComputed) {
                    if (self.model.type === 'live_contract_form' && type === 'checkbox') {
                        value = self.model.isCheckboxFieldChecked(field);
                    } else if (value === null) {
                        value = ''; //prevent evaluating expressions like 'null null undefined', if it's members are empty
                    }

                    if (type === 'group' && field.multiple) {
                        value = typeof(value) !== 'undefined' ? [value] : [];
                    }

                    if (typeof value === 'undefined') return;

                    addGroupedData(data, step.group, field.name, value);
                }
            });

            //Turn step into array of steps, if repeater is set
            //Consider the case when group has dots
            if (step.repeater) {
                var stepValue = getByKeyPath(data, step.group, null);
                var set = stepValue ? [stepValue] : [];

                setByKeyPath(data, step.group, set);
            }
        }

        return data;
    }

    /**
     * Calculate computed expressions for form fields
     * @param  {array} definition  Form definition
     * @return {object}
     */
    function calcComputed(definition) {
        var data = {};

        for (var i = 0; i < definition.length; i++) {
            var step = definition[i];

            Object.keys(step.fields).forEach(function(j) {
                var field = step.fields[j];
                var name = (step.group ? step.group + '.' : '') + field.name;
                var type = self.model.getFieldType(field);
                var value = self.model.getFieldValue(field);

                if (field.validation) {
                    data[name + '-validation'] = expandCondition(field.validation, step.group || '', true);
                }

                if (type === 'expression' && !step.repeater) {
                    setComputedForExpression(name, step, field, data);
                } else if (type === 'external_data' || field.external_source) {
                    setComputedForExternalUrls(name, step, field, data);
                }

                //Computed default value
                if (typeof(value) === 'string' && value.indexOf('{{') !== -1) {
                    setComputedForDefaults(name, step, field, data);
                }

                setComputedForConditions(name, step, field, data);
            });

            if (step.repeater) {
                setComputedForRepeater(step, data);
            }
        }

        return data;
    }

    /**
     * Calculate meta data for form fields
     * @param  {array} definition  Form definition
     * @return {object}
     */
    function calcMeta(definition) {
        var data = {};

        for (var i = 0; i < definition.length; i++) {
            var step = definition[i];

            Object.keys(step.fields).forEach(function(j) {
                var field = step.fields[j];
                var type = self.model.getFieldType(field);
                var meta = { type: type };

                if (typeof field.validation !== 'undefined') {
                    meta.validation = field.validation;
                }

                if (field.today) meta.default = 'today';
                if (field.conditions_field) meta.conditions_field = field.conditions_field;

                if (type === 'amount') {
                    var units = self.model.getAmountUnits(field, true);
                    meta.singular = units.singular;
                    meta.plural = units.plural;
                }

                if (field.external_source) {
                    var use = ['external_source', 'url', 'headerName', 'headerValue', 'conditions', 'url_field', 'jmespath', 'autoselect'];

                    for (var k = 0; k < use.length; k++) {
                        meta[use[k]] = field[use[k]];
                    }
                }

                if (type === 'external_data') {
                    var use = ['jmespath', 'url', 'headerName', 'headerValue', 'conditions', 'url_field'];

                    for (var k = 0; k < use.length; k++) {
                        meta[use[k]] = field[use[k]];
                    }
                }

                if (type === 'date') {
                    var dateLimits = self.model.getDateLimits(field);
                    cloner.shallow.merge(meta, dateLimits);

                    meta.yearly = !!(typeof field.yearly !== 'undefined' && field.yearly);
                }

                if (type === 'expression' && step.repeater) {
                    var expression = {};
                    var name = (step.group ? step.group + '.' : '') + field.name;
                    var key = name + '-expression';

                    setComputedForExpression(name, step, field, expression);
                    meta.expressionTmpl = expression[key];
                }

                addGroupedData(data, step.group, field.name, meta);
            });

            //Turn step meta into array, if repeater is set
            //We don't need to consider the case when group has dots in name,
            //  because we only need to obtain meta by full group name
            if (step.repeater) {
                data[step.group] = data[step.group] ? [data[step.group]] : [];
            }
        }

        return data;
    }

    /**
     * Set computed vars for 'repeater' property of step
     * @param {object} step  Step properties
     * @param {object} data  Object to save result to
     */
    function setComputedForRepeater(step, data) {
        if (!step.group) {
            throw 'Step should have a group, if it has repeater';
        }

        var computed = step.repeater.replace(computedRegexp, function(match, str, prefix, scoped, keypath) {
                if (str) return match; // Just a string
                if (!scoped && globals.indexOf(keypath) > 0) return match; // A global, not a keypath
                return prefix + '${' + (scoped && step.group ? step.group + '.' : '') + keypath + '}';
            }
        );

        var key = step.group + '-repeater';
        data[key] = computed;
    }

    /**
     * Get computed vars for 'value' field (e.g. default value)
     * @param {string} name   Field name
     * @param {object} step   Step data
     * @param {object} field  Field data
     * @param {object} data   Object to save result to
     */
    function setComputedForDefaults(name, step, field, data) {
        var value = self.model.getFieldValue(field);
        if (typeof(value) !== 'string') return;

        var computed = value.replace(/("(?:[^"\\]+|\\.)*"|'(?:[^'\\]+|\\.)*')|(^|[^\w\.\)\]\"\']){{\s*(\.?)(\w[^}]*)\s*}}/g, function(match, str, prefix, scoped, keypath) {
                if (str) return match; // Just a string
                if (!scoped && globals.indexOf(keypath) > 0) return match; // A global, not a keypath
                return prefix + '${' + (scoped && step.group ? step.group + '.' : '') + keypath.trim() + '}';
            }
        );

        if (field.trim) computed = 'new String(' + computed + ').trim()';

        var key = name + '-default';
        data[key] = computed;
    }

    /**
     * Get computed vars for 'expression' field
     * @param {string} name   Field name
     * @param {object} step   Step data
     * @param {object} field  Field data
     * @param {object} data   Object to save result to
     */
    function setComputedForExpression(name, step, field, data) {
        var computed = field.expression.replace(computedRegexp, function(match, str, prefix, scoped, keypath) {
                if (str) return match; // Just a string
                if (!scoped && globals.indexOf(keypath) > 0) return match; // A global, not a keypath
                return prefix + '${' + (scoped && step.group ? step.group + '.' : '') + keypath + '}';
            }
        );

        if (field.trim) computed = 'new String(' + computed + ').trim()';

        var key = name + '-expression';
        field.expression_field = key;
        data[key] = computed;
    }

    /**
     * Get computed vars for 'external_data' and 'external_source' fields
     * @param {string} name   Field name
     * @param {object} step   Step data
     * @param {object} field  Field data
     * @param {object} data   Object to save result to
     */
    function setComputedForExternalUrls(name, step, field, data) {
        var urlName = name + '-url';
        var url = ltriToUrl(field.url);
        var vars = url.match(/\{\{[^}]+\}\}/g);
        field.url_field = urlName;

        if (vars) {
            for (var i = 0; i < vars.length; i++) {
                url = url.replace(vars[i], "' + " + vars[i] + " + '");
            }
        }

        url = "'" + url + "'";
        data[urlName] = url.replace(/\{\{\s*/g, '${').replace(/\s*\}\}/g, '}');
    }

    /**
     * Save conditions as computed properties
     * Add step condition to fields conditions, to reset all step fields when step is hidden
     * @param {string} name   Field name
     * @param {object} step   Step data
     * @param {object} field  Field data
     * @param {object} data   Object to save result to
     */
    function setComputedForConditions(name, step, field, data) {
        var type = self.model.getFieldType(field);

        if (['select', 'group'].indexOf(type) !== -1) {
            setComputedForOptionsConditions(name, step, field, data);
        }

        if (((!field.conditions || field.conditions.length == 0) && (!step.conditions || step.conditions.length == 0)) || type === "expression") {
            delete field.conditions_field;
            return;
        }

        var key = name + '-conditions';
        field.conditions_field = key;

        var conditions = [];
        if (step.conditions && step.conditions.length > 0) conditions.push('(' + step.conditions + ')');
        if (field.conditions && field.conditions.length > 0) conditions.push('(' + field.conditions + ')');

        data[key] = expandCondition(conditions.join(' && '), step.group || '', true);
    }

    /**
     * Save conditions for 'select' and 'group' options as computed properties
     * @param {string} name  Field name
     * @param {object} step  Step data
     * @param {object} field Field data
     * @param {object} data  Object to save result to
     */
    function setComputedForOptionsConditions(name, step, field, data) {
        var options = self.model.getListOptions(field);
        if (!options) return;

        for (var i = 0; i < options.length; i++) {
            var option = options[i];
            if (typeof option.condition === 'undefined') continue;

            var key = name + '-condition-option';
            data[key] = expandCondition(option.condition, step.group || '', true);
        }
    }

    /**
     * Save defaults for amount field
     * @param {object} data   Object to save result to
     * @param {string} group  Group name
     * @param {object} field  Field data
     */
    function addAmountDefaults(data, group, field, isComputed) {
        var value = self.model.getFieldValue(field);
        var units = self.model.getAmountUnits(field);
        var amount = isComputed ? "" :  //Real value will be set from calculated default field,
            (value !== null ? value : "");

        var fielddata = {
            amount: amount,
            unit: value == 1 ? units[0].singular : units[0].plural
        };

        addGroupedData(data, group, field.name, fielddata);
    }

    /**
     * Create nested object for fields with dot notation in names
     * @param {object} data
     * @param {string} group  Group name
     * @param {string} name   Field name
     * @param {object} value
     * @return {object}
     */
    function addGroupedData(data, group, name, value) {
        var object = o = {};

        if (group) name = group + '.' + name;
        var names = name.split('.');

        for (var i = 0, c = names.length; i < c; i++){
            o[names[i]] = (i + 1 == c) ? value : {};
            o = o[names[i]];
        }

        cloner.deep.merge(data, object);

        return data;
    }
}
