'use strict';

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var path = require('path');
var gherkin = require('gherkin');
var glob = require('glob');
var cucumber = require('cucumber');
var _ = require('lodash');
var fs = require('fs');
var MultiRegExp = require('../lib/MultiRegexp');

var Parser = gherkin.Parser;

var templatesExtracted = false;
var aliasRe = /\${(.*)}/g;
var aliasDefRe = /^(.*)\s+=\s+(.*)$/;
var templates = {};

var colors = require('colors/safe');

var stepPattens = [];
var replacements = {};

var AdvancedParser = function (_Parser) {
    _inherits(AdvancedParser, _Parser);

    function AdvancedParser() {
        var _temp, _this, _ret;

        _classCallCheck(this, AdvancedParser);

        var origin = (_temp = (_this = _possibleConstructorReturn(this, (AdvancedParser.__proto__ || Object.getPrototypeOf(AdvancedParser)).call(this)), _this), _this.test = true, _temp);
        var parse = origin.parse;

        _this.parse = function () {
            var document = parse.apply(this, arguments);

            if (!templatesExtracted) {
                this.extractTemplates(document);
            } else {
                this.replaceTemplates(document);
                this.applyAliases(document);
            }

            return document;
        };
        return _ret = origin, _possibleConstructorReturn(_this, _ret);
    }

    _createClass(AdvancedParser, [{
        key: 'extractTemplates',
        value: function extractTemplates(document) {
            var _this2 = this;

            _.each(document.feature.children, function (pickle) {
                if (pickle.type === "Scenario" && _this2.isTemplate(pickle)) {
                    templates[pickle.name] = pickle.steps;
                }
            });
        }
    }, {
        key: 'interpolate',
        value: function interpolate(value, aliases) {
            if (aliasRe.test(value)) {
                // special alias syntax is used
                value = value.replace(aliasRe, function (search, match) {
                    var _iteratorNormalCompletion = true;
                    var _didIteratorError = false;
                    var _iteratorError = undefined;

                    try {
                        for (var _iterator = aliases[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                            var _step$value = _slicedToArray(_step.value, 2);

                            var name = _step$value[0];
                            var replacement = _step$value[1];

                            if (new RegExp(name).test(match)) {
                                return replacement;
                            }
                        }
                    } catch (err) {
                        _didIteratorError = true;
                        _iteratorError = err;
                    } finally {
                        try {
                            if (!_iteratorNormalCompletion && _iterator.return) {
                                _iterator.return();
                            }
                        } finally {
                            if (_didIteratorError) {
                                throw _iteratorError;
                            }
                        }
                    }

                    throw new Error('Unknown alias \'' + match + '\'');
                });
            }

            // value may match alias
            // TODO: dry
            var _iteratorNormalCompletion2 = true;
            var _didIteratorError2 = false;
            var _iteratorError2 = undefined;

            try {
                for (var _iterator2 = aliases[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
                    var _step2$value = _slicedToArray(_step2.value, 2);

                    var name = _step2$value[0];
                    var replacement = _step2$value[1];

                    if (new RegExp(name).test(value)) {
                        value = replacement;
                        break;
                    }
                }
            } catch (err) {
                _didIteratorError2 = true;
                _iteratorError2 = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion2 && _iterator2.return) {
                        _iterator2.return();
                    }
                } finally {
                    if (_didIteratorError2) {
                        throw _iteratorError2;
                    }
                }
            }

            if (value.match(aliasRe)) {
                value = this.interpolate(value, aliases);
            }
            return value;
        }
    }, {
        key: 'replaceAliases',
        value: function replaceAliases(step, aliases) {
            var _this3 = this;

            _.takeRightWhile(stepPattens, function (pattern) {
                if (pattern.test(step)) {
                    var params = _.toArray(new MultiRegExp(pattern).exec(step));

                    if (params.length) {
                        var replaceRegions = _.map(params, function (param) {
                            return {
                                start: param.index,
                                end: param.index + param.text.length,
                                origin: param.text,
                                replacement: _this3.interpolate(param.text, aliases)
                            };
                        });

                        _.reduce(replaceRegions, function (shift, region) {
                            step = [step.slice(0, region.start + shift), region.replacement, step.slice(region.end + shift)].join('');
                            return shift + region.replacement.length - region.origin.length;
                        }, 0);

                        return false; // end iteration
                    }
                }
                return true;
            });
            return step;
        }
    }, {
        key: 'applyAliases',
        value: function applyAliases(document) {
            var _this4 = this;

            var aliases = new Map();
            document.feature.children = _.map(document.feature.children, function (pickle, i) {
                var resultSteps = [];

                if (pickle.type === "Background") {
                    (function () {
                        var resultSteps = [];
                        _.each(pickle.steps, function (step) {
                            step.realName = _this4.text;
                            if (aliasDefRe.test(step.text)) {
                                var _step$text$match = step.text.match(aliasDefRe);

                                var _step$text$match2 = _slicedToArray(_step$text$match, 3);

                                var __ = _step$text$match2[0];
                                var name = _step$text$match2[1];
                                var value = _step$text$match2[2];

                                aliases.set(name.trim(), value);
                            } else {
                                resultSteps.push(step);
                            }
                        });
                    })();
                } else {
                    _.each(pickle.steps, function (step) {
                        try {
                            step.realName = _this4.text;
                            var finiteText = _this4.replaceAliases(step.text, aliases);
                            if (finiteText !== step.text) {
                                replacements[finiteText] = step.text;
                            }
                            step.text = finiteText;
                        } catch (e) {
                            var line = _this4.getStepLine(step);
                            e.message += ' (at line ' + line + ')';
                            throw e;
                        }
                        resultSteps.push(step);
                    });
                }
                pickle.steps = resultSteps;
                return pickle;
            });
        }
    }, {
        key: 'getStepLine',
        value: function getStepLine(step) {
            return step.originLocation && step.originLocation.line || step.location.line;
        }
    }, {
        key: 'isTemplate',
        value: function isTemplate(pickle) {
            return _.some(pickle.tags, { type: "Tag", name: "@$" });
        }
    }, {
        key: 'replaceSteps',
        value: function replaceSteps(steps) {
            var result = [];
            _.each(steps, function (step) {
                if (templates[step.text]) {
                    _.each(templates[step.text], function (tplStep) {
                        tplStep.originLocation = _.clone(tplStep.location);
                        result.push(_.assign({}, tplStep, { location: step.location }));
                    });
                } else {
                    result.push(step);
                }
            });
            if (JSON.stringify(steps) !== JSON.stringify(result)) {
                // TODO: use diff lib
                steps = this.replaceSteps(result);
            }
            return steps;
        }
    }, {
        key: 'replaceTemplates',
        value: function replaceTemplates(document) {
            var _this5 = this;

            var pickles = [];
            _.each(document.feature.children, function (pickle) {
                if (!_this5.isTemplate(pickle)) {
                    pickle.steps = _this5.replaceSteps(pickle.steps);
                    pickles.push(pickle);
                }
            });
            // console.log(JSON.stringify(pickles, null, 2));
            document.feature.children = pickles;
        }
    }]);

    return AdvancedParser;
}(Parser);

// replace parser


gherkin.Parser = AdvancedParser;

function getPath() {
    return path.resolve(path.join.apply(path, arguments));
}

var Runtime = function () {
    function Runtime() {
        _classCallCheck(this, Runtime);

        this.defaults = {
            version: '1.2.1', // TODO: get version from package json
            require: [],
            compiler: [],
            format: ['pretty'],
            name: [],
            colors: true,
            profile: [],
            tags: []
        };
    }

    _createClass(Runtime, [{
        key: 'run',
        value: function run(options) {
            var config = _.assign({}, this.defaults, options);
            var configuration = cucumber.Cli.Configuration(config, options.args || []);

            var runtime = cucumber.Runtime(configuration);

            colors.enabled = config.colors;

            if (!config.dryRun) {
                var formatters = configuration.getFormatters();

                formatters.forEach(function (formatter) {
                    // TODO: extend formatter to output origin step (with vars)
                    // and step with resolved vars values
                    formatter.logStepResult = function (step, stepResult) {
                        var alias = replacements[step.getName()] || '';
                        var identifier = step.getKeyword() + (alias || step.getName() || '');
                        identifier = formatter.applyColor(stepResult, identifier);
                        formatter.logIndented(identifier, 2);
                        formatter.log('\n');

                        if (alias) {
                            formatter.logIndented(colors.grey('\\_ ' + step.getName()), 3);
                            formatter.log('\n');
                        }

                        step.getArguments().forEach(function (arg) {
                            var str = void 0;
                            switch (arg.getType()) {
                                case 'DataTable':
                                    str = formatter.formatDataTable(stepResult, arg);
                                    break;
                                case 'DocString':
                                    str = formatter.formatDocString(stepResult, arg);
                                    break;
                                default:
                                    throw new Error('Unknown argument type: ' + arg.getType());
                            }
                            formatter.logIndented(str, 3);
                        });
                    };

                    runtime.attachListener(formatter);
                });
            }

            return new Promise(function (resolve) {
                runtime.start(resolve);
            }).catch(function (e) {
                console.log(e);
            });
        }
    }]);

    return Runtime;
}();

var runtime = new Runtime();

function extractPatterns(filesPattern) {
    var pattern = /\/\^([^\$]+)\$\//g;

    return _(glob.sync(filesPattern.replace(/\/$/, '') + '/**/*.js')).map(function (file) {
        return fs.readFileSync(file).toString().match(pattern);
    }).flatten().compact().map(function (pattern) {
        return new RegExp(pattern.slice(1, -1).replace(/\\/g, '\\'));
    }).value();
}

module.exports = function run(options) {
    stepPattens = extractPatterns(options.definitions);

    var runtime = new Runtime(options);

    runtime.run({
        dryRun: true,
        args: [options.features]
    }).then(function () {
        templatesExtracted = true;

        runtime.run({
            args: [options.features].concat(options.args),
            require: [options.definitions]
        }).then(function (result) {});
    });
};