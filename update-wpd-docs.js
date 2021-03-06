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
    .option("-s, --sort", "Sort the outputted array(s) alphabetically")
    .option("-l, --lowercase-keys", "Make object keys all-lowercase")
    .option("--nv, --exclude-vendor-prefixed", "Exclude vendor prefixed properties")
    .option("--add-protocol", "Use https:// protocol instead of protocol-relative URLs")
    .option("--path, --paths <s>", "Comma-separated list of path(s) to include", config.paths)
    .parse(process.argv);

// Apply defaults
program.sort = program.sort || config.sort;
program.lowercaseKeys = program.lowercaseKeys || config["lowercase-keys"];
program.excludeVendorPrefixed = program.excludeVendorPrefixed || !config["vendor-prefixes"];
program.addProtocol = program.addProtocol || config["add-protocol"];

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

function fixUpLinks(str, url) {
    return str.replace(/\[(https?|news|ftp|mailto|gopher|irc):(\/*)([^\]]*?) (.*?)\]/g, "<a href='$1:$2$3'>$4</a>")
              .replace(/\[\[(#[^|]*?)\]\](\w*)/g, "<a href='" + url + "$1'>$1$2</a>")
              .replace(/\[\[(#.*?)\|([^\]]+?)\]\](\w*)/g, "<a href='" + url + "$1'>$2$3</a>");
}

function createURLs(url, path) {
    var newUrl = {};
    Object.keys(url).forEach(function (key) {
        newUrl[key] = url[key].replace("{{1}}", encodeURIComponent(path));
    });
    return newUrl;
}

function sortFunction(a, b) { // function for sorting the values, specifically
    function removeNonAlphanumeric(str) {
        return str.replace(/&\w+;/g, "").replace(/[^\w\s]/g, ""); // remove escaped HTML tags and non-alphanumeric chars first
    }
    
    return removeNonAlphanumeric(a.value).localeCompare(removeNonAlphanumeric(b.value));
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
                    var url = data.fullurl;
                    if (program.addProtocol && url && url.substr(0, 2) === "//") {
                        url = "https:" + url;
                    }
                    propertyData.SUMMARY = instaview.convert(fixUpLinks(htmlEscape(data.printouts.Summary[0]), url));
                    propertyData.URL = url;

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
                        var forProperty = valueIdentifier.split("#")[0]; // object key w/o hash
                        if (forProperty && program.lowercaseKeys) {
                            forProperty = forProperty.toLowerCase();
                        }
                        var valueData = {};
                        var description;
                        if (data["Property value"].length && forProperty && result.hasOwnProperty(forProperty)) {
                            var parentUrl = result[forProperty].URL;
                            valueData.description = "";
                            if (data["Property value description"].length) {
                                // Remove possible "alt=...;" (image Wikitext), then fix a bug with parsing tables
                                description = htmlEscape(data["Property value description"][0].replace(/\|alt=([^;]*);/, "|$1").replace(/\:\{\|/g, "{|"));
                                valueData.description = instaview.convert(fixUpLinks(description, parentUrl));
                            }
                            valueData.value = instaview.convert(fixUpLinks(htmlEscape(data["Property value"][0]), parentUrl)).substr(3); // trim <p> tag

                            if (!result[forProperty].VALUES) {
                                result[forProperty].VALUES = [];
                            }
                            result[forProperty].VALUES.push(valueData);
                        }
                    });
                    if (program.sort) {
                        var currentObj;
                        Object.keys(result).forEach(function (currentKey) {
                            currentObj = result[currentKey];
                            if (currentObj && currentObj.VALUES) {
                                currentObj.VALUES.sort(sortFunction);
                            }
                        });
                    }
                    
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
