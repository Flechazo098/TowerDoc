/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const fs = require("fs");

const navigation = require("./route.json");
const langDefault = require("./lang/zh/Route_zh.json");

const Route = navigation.routes;
const categoryIndexes = navigation.categoryIndexes;

// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
    docs: [],
};

const categories = new Map();

for (const routeKey in Route) {
    const categoryIndex = categoryIndexes[routeKey];
    const category = {
        type: "category",
        items: [...Route[routeKey]],
        link: categoryIndex
            ? {
                type: "doc",
                id: categoryIndex,
            }
            : {
                type: "generated-index",
                slug: `/${routeKey}`,
            },
        label: routeKey in langDefault ? langDefault[routeKey] : routeKey,
    };

    categories.set(routeKey, category);
}

// Replace child category IDs with their complete category objects. Processing
// deepest categories first supports any nesting depth without path corruption.
const categoryKeysByDepth = [...categories.keys()].sort(
    (left, right) => right.split("/").length - left.split("/").length,
);
const nestedCategoryKeys = new Set();

for (const categoryKey of categoryKeysByDepth) {
    const parentKey = categoryKey.split("/").slice(0, -1).join("/");
    const parentCategory = categories.get(parentKey);
    if (!parentCategory) continue;

    const itemIndex = parentCategory.items.indexOf(categoryKey);
    if (itemIndex !== -1) {
        parentCategory.items[itemIndex] = categories.get(categoryKey);
        nestedCategoryKeys.add(categoryKey);
    }
}

for (const [categoryKey, category] of categories) {
    if (!nestedCategoryKeys.has(categoryKey)) {
        sidebars.docs.push(category);
    }
}

sidebars.docs.unshift({ type: "doc", id: "README", label: "索引" });

fs.writeFileSync("sidebars.json", JSON.stringify(sidebars), { encoding: "utf-8" });

module.exports = sidebars;
