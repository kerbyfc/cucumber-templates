const path = require('path');
const gherkin = require('gherkin');
const glob = require('glob');
const cucumber = require('cucumber');
const _ = require('lodash');
const fs = require('fs');
const MultiRegExp = require('../lib/MultiRegexp');

const Parser = gherkin.Parser;

let templatesExtracted = false;
const aliasRe = /\${(.*)}/g;
const aliasDefRe = /^(.*)\s+=\s+(.*)$/;
const templates = {};

const colors = require('colors/safe');

let stepPattens = [];
const replacements = {};

class AdvancedParser extends Parser {

    test = true;

    constructor() {
        const origin = super();
        const parse = origin.parse;

        this.parse = function () {
            const document = parse.apply(this, arguments);

            if (!templatesExtracted) {
                this.extractTemplates(document);
            } else {
                this.replaceTemplates(document);
                this.applyAliases(document);
            }

            return document;
        };
        return origin;
    }

    extractTemplates(document) {
        _.each(document.feature.children, (pickle) => {
            if (pickle.type === "Scenario" && this.isTemplate(pickle)) {
                templates[pickle.name] = pickle.steps;
            }
        });
    }

    interpolate(value, aliases) {
        if (aliasRe.test(value)) {
            // special alias syntax is used
            value = value.replace(aliasRe, (search, match) => {
                for (let [name, replacement] of aliases) {
                    if (new RegExp(name).test(match)) {
                        return replacement;
                    }
                }
                throw new Error(`Unknown alias '${match}'`);
            });
        }

        // value may match alias
        // TODO: dry
        for (let [name, replacement] of aliases) {
            if (new RegExp(name).test(value)) {
                value = replacement;
                break;
            }
        }

        if (value.match(aliasRe)) {
            value = this.interpolate(value, aliases);
        }
        return value;
    }

    replaceAliases(step, aliases) {
        _.takeRightWhile(stepPattens, (pattern) => {
            if (pattern.test(step)) {
                const params = _.toArray(new MultiRegExp(pattern).exec(step));

                if (params.length) {
                    const replaceRegions = _.map(params, (param) => {
                        return {
                            start: param.index,
                            end: param.index + param.text.length,
                            origin: param.text,
                            replacement: this.interpolate(param.text, aliases)
                        };
                    });

                    _.reduce(replaceRegions, (shift, region) => {
                        step = [
                            step.slice(0, region.start + shift),
                            region.replacement,
                            step.slice(region.end + shift)
                        ].join('');
                        return region.replacement.length - region.origin.length;
                    }, 0);

                    return false; // end iteration
                }
            }
            return true;
        });
        return step;
    }

    applyAliases(document) {
        let aliases = new Map();
        document.feature.children = _.map(document.feature.children, (pickle, i) => {
            const resultSteps = [];

            if (pickle.type === "Background") {
                const resultSteps = [];
                _.each(pickle.steps, (step) => {
                    step.realName = this.text;
                    if (aliasDefRe.test(step.text)) {
                        let [__, name, value] = step.text.match(aliasDefRe);
                        aliases.set(name.trim(), value);
                    } else {
                        resultSteps.push(step);
                    }
                });
            } else {
                _.each(pickle.steps, (step) => {
                    try {
                        step.realName = this.text;
                        const finiteText = this.replaceAliases(step.text, aliases);
                        if (finiteText !== step.text) {
                            replacements[finiteText] = step.text
                        }
                        step.text = finiteText;
                    } catch (e) {
                        let line = this.getStepLine(step);
                        e.message += ` (at line ${line})`;
                        throw e;
                    }
                    resultSteps.push(step);
                });
            }
            pickle.steps = resultSteps;
            return pickle;
        });
    }

    getStepLine(step) {
        return step.originLocation && step.originLocation.line || step.location.line;
    }

    isTemplate(pickle) {
        return _.some(pickle.tags, {type: "Tag", name: "@$"});
    }

    replaceSteps(steps) {
        const result = [];
        _.each(steps, (step) => {
            if (templates[step.text]) {
                _.each(templates[step.text], (tplStep) => {
                    tplStep.originLocation = _.clone(tplStep.location);
                    result.push(_.assign({}, tplStep, {location: step.location}));
                });
            } else {
                result.push(step);
            }
        });
        if (JSON.stringify(steps) !== JSON.stringify(result)) { // TODO: use diff lib
            steps = this.replaceSteps(result);
        }
        return steps;
    }

    replaceTemplates(document) {
        const pickles = [];
        _.each(document.feature.children, (pickle) => {
            if (!this.isTemplate(pickle)) {
                pickle.steps = this.replaceSteps(pickle.steps);
                pickles.push(pickle);
            }
        });
        // console.log(JSON.stringify(pickles, null, 2));
        document.feature.children = pickles;
    }
}

// replace parser
gherkin.Parser = AdvancedParser;

function getPath() {
    return path.resolve(path.join.apply(path, arguments));
}

class Runtime {

    defaults = {
        version: '1.2.1', // TODO: get version from package json
        require: [],
        compiler: [],
        format: ['pretty'],
        name: [],
        colors: true,
        profile: [],
        tags: []
    };

    run(options) {
        const config = _.assign({}, this.defaults, options);
        const configuration = cucumber.Cli.Configuration(config, options.args || []);

        const runtime = cucumber.Runtime(configuration);

        colors.enabled = config.colors;

        if (!config.dryRun) {
            const formatters = configuration.getFormatters();

            formatters.forEach(function (formatter) {
                // TODO: extend formatter to output origin step (with vars)
                // and step with resolved vars values
                formatter.logStepResult = (step, stepResult) => {
                    const alias = replacements[step.getName()] || '';
                    let identifier = step.getKeyword() + (alias || step.getName() || '');
                    identifier = formatter.applyColor(stepResult, identifier);
                    formatter.logIndented(identifier, 2);
                    formatter.log('\n');

                    if (alias) {
                        formatter.logIndented(colors.grey('\\_ ' + step.getName()), 3);
                        formatter.log('\n');
                    }

                    step.getArguments().forEach(function (arg) {
                        let str;
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

        return new Promise((resolve) => {
            runtime.start(resolve);
        }).catch((e) => {
            console.log(e);
        });
    }

}

const runtime = new Runtime();

function extractPatterns(filesPattern) {
    const pattern = /\/\^([^\$]+)\$\//g;

    return _(glob.sync(filesPattern.replace(/\/$/, '') + '/**/*.js'))
        .map((file) => {
            return fs.readFileSync(file).toString().match(pattern);
        }).flatten().compact()
        .map((pattern) => {
            return new RegExp(pattern.slice(1, -1).replace(/\\/g, '\\'));
        })
        .value();
}

module.exports = function run(options) {
    stepPattens = extractPatterns(options.definitions);

    const runtime = new Runtime(options);

    runtime.run({
        dryRun: true,
        args: [options.features]
    })
        .then(() => {
            templatesExtracted = true;

            runtime.run({
                args: [options.features].concat(options.args),
                require: [options.definitions]
            })
                .then((result) => {
                });
        });
};
