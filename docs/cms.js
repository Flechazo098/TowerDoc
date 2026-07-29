const contentful = require("contentful");
const fs = require("fs");
const path = require("path");

const ENGLISH_PREFIX = "en/";

async function main() {
    if (!process.env.CMS_ACCESS_TOKEN) {
        require("dotenv").config();
    }

    const client = contentful.createClient(parseToken());
    const content = {
        lang: [],
        document: [],
        author: [],
    };

    const entries = await client.getEntries();
    entries.items.forEach(entry => {
        content[entry.sys.contentType.sys.id].push(entry.fields);
    });

    clearDirectorySync("./docs");

    const navigation = buildNavigation(content.document);
    fs.writeFileSync("./route.json", JSON.stringify(navigation), { encoding: "utf-8" });

    content.document.forEach(document => {
        writeDocument(document, navigation.categoryIndexes);
    });

    clearDirectorySync("./lang");
    fs.mkdirSync("./lang/zh", { recursive: true });
    fs.mkdirSync("./lang/en", { recursive: true });
    content.lang.forEach(lang => {
        fs.writeFileSync(
            `./lang/${lang.type}/${lang.field}.json`,
            JSON.stringify(lang.content),
            { encoding: "utf-8" },
        );
    });
}

function buildNavigation(documents) {
    const defaultDocuments = documents
        .map(getDocumentMetadata)
        .filter(document => document.locale === "zh-cn");

    const categoryIndexMetadata = defaultDocuments.filter(document =>
        defaultDocuments.some(other =>
            other.logicalPath.startsWith(`${document.logicalPath}/`),
        ),
    );

    const categoryIndexes = Object.fromEntries(
        categoryIndexMetadata.map(document => [document.logicalPath, document.id]),
    );
    const categoryIndexPaths = new Set(Object.keys(categoryIndexes));
    const routes = new Map();
    const routeItemOrders = new Map();

    function ensureRoute(routeKey) {
        if (!routeKey) return;
        if (!routes.has(routeKey)) routes.set(routeKey, []);
        if (!routeItemOrders.has(routeKey)) routeItemOrders.set(routeKey, new Map());
    }

    function addRouteItem(routeKey, item, order, forceOrder = false) {
        if (!routeKey) return;
        ensureRoute(routeKey);

        const items = routes.get(routeKey);
        if (!items.includes(item)) items.push(item);

        const orders = routeItemOrders.get(routeKey);
        const normalizedOrder = normalizeOrder(order);
        if (
            forceOrder ||
            !orders.has(item) ||
            normalizedOrder < orders.get(item)
        ) {
            orders.set(item, normalizedOrder);
        }
    }

    function ensureCategoryHierarchy(categoryPath, order) {
        if (!categoryPath) return;
        const segments = categoryPath.split("/");

        for (let length = 1; length <= segments.length; length++) {
            const categoryKey = segments.slice(0, length).join("/");
            ensureRoute(categoryKey);

            if (length > 1) {
                const parentKey = segments.slice(0, length - 1).join("/");
                addRouteItem(parentKey, categoryKey, order);
            }
        }
    }

    defaultDocuments.forEach(document => {
        const isCategoryIndex = categoryIndexPaths.has(document.logicalPath);
        const categoryPath = isCategoryIndex
            ? document.logicalPath
            : document.parentPath;

        ensureCategoryHierarchy(categoryPath, document.order);

        if (!isCategoryIndex && document.parentPath) {
            addRouteItem(document.parentPath, document.id, document.order);
        }
    });

    categoryIndexMetadata.forEach(document => {
        if (document.parentPath && hasOrder(document.order)) {
            addRouteItem(
                document.parentPath,
                document.logicalPath,
                document.order,
                true,
            );
        }
    });

    const serializedRoutes = {};
    routes.forEach((items, routeKey) => {
        const orders = routeItemOrders.get(routeKey);
        serializedRoutes[routeKey] = [...items].sort(
            (left, right) => orders.get(left) - orders.get(right),
        );
    });

    return {
        routes: serializedRoutes,
        categoryIndexes,
    };
}

function getDocumentMetadata(document) {
    let logicalPath = normalizeDocumentPath(document.path);
    let locale = "zh-cn";

    if (logicalPath.startsWith(ENGLISH_PREFIX)) {
        locale = "en";
        logicalPath = logicalPath.slice(ENGLISH_PREFIX.length);
    }

    const segments = logicalPath.split("/").filter(Boolean);
    if (segments.length === 0) {
        throw new Error("Document path cannot be empty.");
    }
    if (segments.some(segment => segment === "." || segment === "..")) {
        throw new Error(`Document path contains an invalid segment: ${document.path}`);
    }

    const title = segments.at(-1);
    const parentSegments = segments.slice(0, -1);
    const parentPath = parentSegments.join("/");
    const slug = String(document.slug || "").trim();

    if (!slug || slug.includes("/") || slug.includes("\\")) {
        throw new Error(`Document slug is invalid for path: ${document.path}`);
    }

    return {
        locale,
        logicalPath,
        parentPath,
        parentSegments,
        title,
        slug,
        id: [...parentSegments, slug].join("/"),
        order: document.order,
    };
}

function writeDocument(document, categoryIndexes) {
    const metadata = getDocumentMetadata(document);
    const isCategoryIndex = Object.hasOwn(categoryIndexes, metadata.logicalPath);
    const rootDirectory = metadata.locale === "en"
        ? "./i18n/en/docusaurus-plugin-content-docs/current"
        : "./docs";
    const outputDirectory = path.join(rootDirectory, ...metadata.parentSegments);
    const extension = isCategoryIndex ? ".mdx" : ".md";

    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(
        path.join(outputDirectory, `${metadata.slug}${extension}`),
        createDocumentSource(document, categoryIndexes),
        { encoding: "utf-8" },
    );
}

function createDocumentSource(document, categoryIndexes) {
    const metadata = getDocumentMetadata(document);
    const isCategoryIndex = Object.hasOwn(categoryIndexes, metadata.logicalPath);
    const source = [];

    if (isCategoryIndex) {
        source.push(
            "---",
            `slug: ${JSON.stringify(`/${metadata.logicalPath}`)}`,
            "---",
            "",
            "import DocCardList from '@theme/DocCardList';",
            "",
        );
    }

    source.push(`# ${metadata.title}`);

    const content = String(document.content || "").trim();
    if (content) source.push("", content);

    if (isCategoryIndex) {
        source.push("", "<DocCardList />");
    }

    return `${source.join("\n")}\n`;
}

function clearDirectorySync(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
    }
    fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeDocumentPath(documentPath) {
    return String(documentPath || "")
        .trim()
        .replaceAll("\\", "/")
        .replace(/^\/+|\/+$/g, "")
        .replace(/\/{2,}/g, "/");
}

function hasOrder(order) {
    return order !== null && order !== undefined && Number.isFinite(Number(order));
}

function normalizeOrder(order) {
    return hasOrder(order) ? Number(order) : Number.MAX_SAFE_INTEGER;
}

function parseToken() {
    const token = process.env.CMS_ACCESS_TOKEN;
    if (!token || !token.includes("/") || !token.includes("@")) {
        throw new Error("CMS_ACCESS_TOKEN is missing or malformed.");
    }

    const [space, credentials] = token.split("/", 2);
    const [environment, accessToken] = credentials.split("@", 2);
    return { space, environment, accessToken };
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
