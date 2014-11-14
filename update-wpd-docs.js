/*
 * Copyright (c) 2014 Adobe Systems Incorporated. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */
/*global require*/
/*jslint node:true, regexp:true */

"use strict";

var fs          = require("fs"),
    https       = require("https"),
    instaview   = require("instaview"), // Wikitext > HTML
    path        = require("path"),
    program     = require("commander");

instaview.conf.paths.articles = "https://docs.webplatform.org/wiki/"; // base URL for every link
instaview.conf.locale.image = "__Image__"; // disable <img> tags

var propertiesURL = "https://docs.webplatform.org/w/api.php?action=ask&format=json&query=%20%5B%5BPath%3A%3A~css%2Fproperties%2F*%5D%5D%7C%3FSummary%7Cprettyprint%3Dno%7Climit%3D100000", // #ask: [[Path::~css/properties/*]]|?Summary|prettyprint=no|limit=100000
    valuesURL = "https://docs.webplatform.org/w/api.php?action=ask&format=json&query=%5B%5BValue%20for%20property%3A%3A~css%2Fproperties%2F*%5D%5D%7C%3FProperty%20value%7C%3FProperty%20value%20description%7C%3FValue%20for%20property%7Cprettyprint%3Dno%7Climit%3D100000"; // #ask: [[Value for property::~css/properties/*]]|?Property value|?Property value description|?Value for property|prettyprint=no|limit=100000

// Parse arguments
program
    .version("0.0.1")
    .option("-o, --output <s>", "The output css.json")
    .option("--nv, --exclude-vendor-prefixed", "Exclude vendor prefixed properties")
    .parse(process.argv);

var result = {},
    outputFile = program.output,
    propertiesResponse = "",
    valuesResponse = "";

if (outputFile) {
    outputFile = path.normalize(path.resolve(__dirname, outputFile));
} else {
    console.error("Usage: update-docs --output outputJSON\nExample: update-docs --output ..\\brackets\\src\\extensions\\default\\WebPlatformDocs\\css.json");
    process.exit();
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

console.log("Getting properties");
https.get(propertiesURL, function (res) {
    res.on("data", function (chunk) {
        propertiesResponse += chunk;
    });

    res.on("end", function () {
        console.log("Parsing properties");
        propertiesResponse = JSON.parse(propertiesResponse).query.results;
        Object.keys(propertiesResponse).forEach(function (propertyName) {
            var propertyLastName = propertyName.substr(propertyName.lastIndexOf("/") + 1);
            if (program.excludeVendorPrefixed && /^-\w+-.+/.test(propertyLastName)) { // Exclude vendor prefixed properties
                return;
            }
            var data = propertiesResponse[propertyName];
            var propertyData = {};
            if (data.printouts.Summary.length) {
                propertyData.SUMMARY = instaview.convert(htmlEscape(data.printouts.Summary[0]));
                propertyData.URL = data.fullurl;

                result[propertyName] = propertyData;
            }
        });
        console.log("Getting values");
        https.get(valuesURL, function (res) {
            res.on("data", function (chunk) {
                valuesResponse += chunk;
            });

            res.on("end", function () {
                console.log("Parsing values");
                valuesResponse = JSON.parse(valuesResponse).query.results;

                Object.keys(valuesResponse).forEach(function (valueIdentifier) {
                    var data = valuesResponse[valueIdentifier].printouts;
                    var forProperty = data["Value for property"].length && data["Value for property"][0].fulltext;
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
                fs.writeFile(outputFile, JSON.stringify({DATETIME: new Date().toUTCString(), PROPERTIES: result}));
                console.log("Done writing " + Object.keys(result).length + " properties.");
            }).on("error", function (e) {
                console.error(e);
            });
        });
    });
}).on("error", function (e) {
    console.error(e);
});
