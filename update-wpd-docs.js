/*global require*/
/*jslint node:true, regexp:true */

"use strict";

var fs          = require("fs"),
    https       = require("https"),
    instaview   = require("instaview"), // Wikitext > HTML
    path        = require("path"),
    program     = require("commander");

var defaults    = JSON.parse(fs.readFileSync("defaults.json")),
    config;
try {
    config      = JSON.parse(fs.readFileSync("config.json"));
} catch (e) {
    config = {};
}

instaview.conf.paths.articles = "https://docs.webplatform.org/wiki/"; // base URL for every link
instaview.conf.locale.image = "__Image__"; // disable <img> tags

var url, rawUrl = {};
rawUrl.page = "https://docs.webplatform.org/w/api.php?action=ask&format=json&query=%20%5B%5BPath%3A%3A~{{1}}%2F*%5D%5D%7C%3FSummary%7Cprettyprint%3Dno%7Climit%3D1000000"; // #ask: [[Path::~{{1}}/*]]|?Summary|prettyprint=no|limit=1000000
rawUrl.properties = "https://docs.webplatform.org/w/api.php?action=ask&format=json&query=%5B%5BValue%20for%20property%3A%3A~{{1}}%2F*%5D%5D%7C%3FProperty%20value%7C%3FProperty%20value%20description%7C%3FValue%20for%20property%7Cprettyprint%3Dno%7Climit%3D1000000"; // #ask: [[Value for property::~{{1}}/*]]|?Property value|?Property value description|?Value for property|prettyprint=no|limit=1000000

function getConfig(alias) {
    var conf = {};
    conf = defaults;
    Object.keys(config).forEach(function (key) {
        conf[key] = config[key];
    });
    var aliasConfig = config.aliases && config.aliases[alias];
    if (alias && aliasConfig) {
        Object.keys(aliasConfig).forEach(function (key) {
            conf[key] = aliasConfig[key];
        });
    }
    return conf;
}

// Parse arguments
program.parse(process.argv);
config = getConfig(program.args[0]);

program
    .version("0.0.1")
    .option("-o, --output <s>", "Path to output JSON", config.output)
    .option("-l, --lowercase-keys", "Make object keys all-lowercase")
    .option("--nv, --exclude-vendor-prefixed", "Exclude vendor prefixed properties")
    .option("--path, --paths <s>", "Comma-separated list of path(s) to include", config.paths)
    .parse(process.argv);

// Apply defaults
program.lowercaseKeys = program.lowercaseKeys || config["lowercase-keys"];
program.excludeVendorPrefixed = program.excludeVendorPrefixed || !config["vendor-prefixes"];

var result = {},
    outputFile = program.output;

if (outputFile) {
    outputFile = path.normalize(path.resolve(__dirname, outputFile));
} else {
    program.help();
}

var message = "Updated data will be written to \"" + outputFile + "\"" + (path.extname(outputFile) === ".json" ? "" : ", which is not a .json file") + ".";
console.log(message);

function htmlEscape(str) {
    return str.replace(/<(\/?)([^>]*)>/g, function (match, slash, inner) {
        if (["code", "div", "tt"].indexOf(inner) === -1) { // escape all tags except <code>, <div>, <tt>
            return "&lt;" + slash + inner + "&gt;";
        }
        return match;
    });
}

function createURLs(url, path) {
    var newUrl = {};
    Object.keys(url).forEach(function (key) {
        newUrl[key] = url[key].replace("{{1}}", encodeURIComponent(path));
    });
    return newUrl;
}

var response, currentPath, oldResultsLength,
    paths = program.paths.split(",");

function get(pathIndex) {
    currentPath = paths[pathIndex];
    if (!currentPath) {
        fs.writeFileSync(outputFile, JSON.stringify({DATETIME: new Date().toUTCString(), PROPERTIES: result}));
        console.log("Done writing " + Object.keys(result).length + " data entries.");
        return;
    }
    oldResultsLength = Object.keys(result).length;
    url = createURLs(rawUrl, currentPath);
    response = "";
    console.log("Path: " + currentPath + ":");
    console.log("Getting main pages");
    https.get(url.page, function (res) {
        res.on("data", function (chunk) {
            response += chunk;
        });

        res.on("end", function () {
            console.log("Parsing main pages");
            response = JSON.parse(response).query.results;
            Object.keys(response).forEach(function (propertyName) {
                var propertyLastName = propertyName.substr(propertyName.lastIndexOf("/") + 1);
                if (program.excludeVendorPrefixed && /^-\w+-.+/.test(propertyLastName)) { // Exclude vendor prefixed properties
                    return;
                }
                var data = response[propertyName];
                var propertyData = {};
                if (data.printouts.Summary.length) {
                    propertyData.SUMMARY = instaview.convert(htmlEscape(data.printouts.Summary[0]));
                    propertyData.URL = data.fullurl;

                    if (program.lowercaseKeys) {
                        propertyName = propertyName.toLowerCase();
                    }
                    result[propertyName] = propertyData;
                }
            });
            console.log("Getting linked properties");
            response = "";
            https.get(url.properties, function (res) {
                res.on("data", function (chunk) {
                    response += chunk;
                });

                res.on("end", function () {
                    console.log("Parsing linked properties");
                    response = JSON.parse(response).query.results;

                    Object.keys(response).forEach(function (valueIdentifier) {
                        var data = response[valueIdentifier].printouts;
                        var forProperty = data["Value for property"].length && data["Value for property"][0].fulltext;
                        if (forProperty && program.lowercaseKeys) {
                            forProperty = forProperty.toLowerCase();
                        }
                        var valueData = {};
                        var description;
                        if (data["Property value"].length && forProperty && result.hasOwnProperty(forProperty)) {
                            valueData.description = "";
                            if (data["Property value description"].length) {
                                // Remove possible "alt=...;" (image Wikitext), then fix a bug with parsing tables
                                description = htmlEscape(data["Property value description"][0].replace(/\|alt=([^;]*);/, "|$1").replace(/\:\{\|/g, "{|"));
                                valueData.description = instaview.convert(description);
                            }
                            valueData.value = instaview.convert(htmlEscape(data["Property value"][0])).substr(3); // trim <p> tag

                            // FUTURE: Currently, there's no deterministic order for the value listing
                            if (!result[forProperty].VALUES) {
                                result[forProperty].VALUES = [];
                            }
                            result[forProperty].VALUES.push(valueData);
                        }
                    });
                    console.log("Collected " + (Object.keys(result).length - oldResultsLength) + " pages in " + currentPath);
                    get(pathIndex + 1);
                }).on("error", function (e) {
                    console.error(e);
                });
            });
        });
    }).on("error", function (e) {
        console.error(e);
    });
}

get(0);
