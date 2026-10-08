/* =========================================================
   AGROSATHI AI
   GLOBAL LANGUAGE SYSTEM
   English / Hindi / Marathi
========================================================= */

(() => {

    "use strict";


    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const STORAGE_KEY = "agrosathi_language";

    const SUPPORTED_LANGUAGES = {
        en: "English",
        hi: "हिन्दी",
        mr: "मराठी"
    };

    const TRANSLATION_ENDPOINT = "/api/translate-text";
    const LANGUAGE_ENDPOINT = "/set-language";

    const BATCH_SIZE = 10;

    const SKIP_TAGS = new Set([
        "SCRIPT",
        "STYLE",
        "NOSCRIPT",
        "CODE",
        "PRE",
        "SVG",
        "OPTION"
    ]);

    const SKIP_ATTRIBUTES = [
        "data-no-translate",
        "data-skip-translation"
    ];


    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    let currentLanguage =
        localStorage.getItem(STORAGE_KEY) || "en";

    if (!SUPPORTED_LANGUAGES[currentLanguage]) {
        currentLanguage = "en";
    }

    const translationMemory = new Map();

    let translationRunning = false;

    let observerTimer = null;


    /* =====================================================
       HELPERS
    ===================================================== */

    function normalizeText(value) {

        return String(value || "")
            .replace(/\s+/g, " ")
            .trim();

    }


    function isLanguageSelector(element) {

        if (!element) {
            return false;
        }

        if (
            element.matches &&
            element.matches(
                "#languageSelector, " +
                "#farmLanguage, " +
                ".language-selector"
            )
        ) {
            return true;
        }

        return false;

    }


    function shouldSkipElement(element) {

        if (!element) {
            return true;
        }

        if (
            SKIP_TAGS.has(element.tagName)
        ) {
            return true;
        }

        for (const attr of SKIP_ATTRIBUTES) {

            if (
                element.hasAttribute(attr)
            ) {
                return true;
            }

        }

        if (
            isLanguageSelector(element)
        ) {
            return true;
        }

        return false;

    }


    function shouldSkipTextNode(node) {

        if (!node) {
            return true;
        }

        const parent = node.parentElement;

        if (!parent) {
            return true;
        }

        if (
            shouldSkipElement(parent)
        ) {
            return true;
        }

        const text = normalizeText(
            node.nodeValue
        );

        if (!text) {
            return true;
        }

        /*
           Ignore very tiny symbols / punctuation.
        */

        if (
            /^[\W_]+$/u.test(text)
        ) {
            return true;
        }

        return false;

    }


    function getOriginalText(node) {

        if (
            !node.hasAttribute(
                "data-agrosathi-original"
            )
        ) {

            node.setAttribute(
                "data-agrosathi-original",
                node.nodeValue
            );

        }

        return node.getAttribute(
            "data-agrosathi-original"
        );

    }


    function getOriginalAttribute(
        element,
        attribute
    ) {

        const key =
            "data-agrosathi-original-" +
            attribute;

        if (
            !element.hasAttribute(key)
        ) {

            element.setAttribute(
                key,
                element.getAttribute(attribute) || ""
            );

        }

        return element.getAttribute(key);

    }


    /* =====================================================
       FIND TEXT NODES
    ===================================================== */

    function collectTextNodes(root) {

        const nodes = [];

        if (!root) {
            return nodes;
        }

        const walker =
            document.createTreeWalker(
                root,
                NodeFilter.SHOW_TEXT
            );

        let node;

        while (
            (node = walker.nextNode())
        ) {

            if (
                shouldSkipTextNode(node)
            ) {
                continue;
            }

            nodes.push(node);

        }

        return nodes;

    }


    /* =====================================================
       COLLECT PLACEHOLDERS / TITLES
    ===================================================== */

    function collectAttributes(root) {

        const result = [];

        if (!root) {
            return result;
        }

        const elements =
            root.querySelectorAll
                ? root.querySelectorAll(
                    "input, textarea, [title], [aria-label]"
                )
                : [];

        for (const element of elements) {

            if (
                shouldSkipElement(element)
            ) {
                continue;
            }


            if (
                element.hasAttribute(
                    "placeholder"
                )
            ) {

                const value =
                    normalizeText(
                        getOriginalAttribute(
                            element,
                            "placeholder"
                        )
                    );

                if (value) {

                    result.push({
                        element,
                        attribute: "placeholder",
                        original: value
                    });

                }

            }


            if (
                element.hasAttribute(
                    "title"
                )
            ) {

                const value =
                    normalizeText(
                        getOriginalAttribute(
                            element,
                            "title"
                        )
                    );

                if (value) {

                    result.push({
                        element,
                        attribute: "title",
                        original: value
                    });

                }

            }


            if (
                element.hasAttribute(
                    "aria-label"
                )
            ) {

                const value =
                    normalizeText(
                        getOriginalAttribute(
                            element,
                            "aria-label"
                        )
                    );

                if (value) {

                    result.push({
                        element,
                        attribute: "aria-label",
                        original: value
                    });

                }

            }

        }

        return result;

    }


    /* =====================================================
       TRANSLATION API
    ===================================================== */

    async function translateBatch(
        items,
        language
    ) {

        if (
            !items.length ||
            language === "en"
        ) {

            return items.map(
                item => item.original
            );

        }


        const textList =
            items.map(
                item => item.original
            );


        const cacheResults = [];
        const missing = [];


        textList.forEach(
            (text, index) => {

                const cacheKey =
                    language + "::" + text;

                if (
                    translationMemory.has(
                        cacheKey
                    )
                ) {

                    cacheResults[index] =
                        translationMemory.get(
                            cacheKey
                        );

                } else {

                    missing.push({
                        index,
                        text
                    });

                }

            }
        );


        if (!missing.length) {

            return cacheResults;

        }


        try {

            const response =
                await fetch(
                    TRANSLATION_ENDPOINT,
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        credentials: "same-origin",

                        body: JSON.stringify({
                            language,
                            texts:
                                missing.map(
                                    item =>
                                        item.text
                                )
                        })
                    }
                );


            if (!response.ok) {

                throw new Error(
                    "Translation request failed."
                );

            }


            const data =
                await response.json();


            if (
                !data.success ||
                !Array.isArray(
                    data.translations
                )
            ) {

                throw new Error(
                    "Invalid translation response."
                );

            }


            missing.forEach(
                (item, index) => {

                    const translated =
                        data.translations[index] ||
                        item.text;

                    const cacheKey =
                        language +
                        "::" +
                        item.text;

                    translationMemory.set(
                        cacheKey,
                        translated
                    );

                    cacheResults[
                        item.index
                    ] = translated;

                }
            );


        } catch (error) {

            console.error(
                "Agrosathi translation error:",
                error
            );


            missing.forEach(
                item => {

                    cacheResults[
                        item.index
                    ] = item.text;

                }
            );

        }


        return cacheResults;

    }


    /* =====================================================
       RESTORE ORIGINAL ENGLISH
    ===================================================== */

    function restoreOriginalContent() {

        const textNodes =
            collectTextNodes(
                document.body
            );

        for (
            const node of textNodes
        ) {

            const original =
                node.getAttribute(
                    "data-agrosathi-original"
                );

            if (
                original !== null
            ) {

                node.nodeValue =
                    original;

            }

        }


        const attributeElements =
            document.querySelectorAll(
                "[data-agrosathi-original-placeholder]," +
                "[data-agrosathi-original-title]," +
                "[data-agrosathi-original-aria-label]"
            );


        for (
            const element of attributeElements
        ) {

            for (
                const attribute of [
                    "placeholder",
                    "title",
                    "aria-label"
                ]
            ) {

                const key =
                    "data-agrosathi-original-" +
                    attribute;

                if (
                    element.hasAttribute(key)
                ) {

                    element.setAttribute(
                        attribute,
                        element.getAttribute(key)
                    );

                }

            }

        }

    }


    /* =====================================================
       TRANSLATE CURRENT PAGE
    ===================================================== */

    async function translatePage(
        language
    ) {

        if (
            translationRunning
        ) {
            return;
        }


        translationRunning = true;


        try {

            document.documentElement.lang =
                language;


            /*
               English:
               restore original content
            */

            if (
                language === "en"
            ) {

                restoreOriginalContent();

                return;

            }


            const textNodes =
                collectTextNodes(
                    document.body
                );


            const attributes =
                collectAttributes(
                    document.body
                );


            const allItems = [];


            for (
                const node of textNodes
            ) {

                const original =
                    normalizeText(
                        getOriginalText(node)
                    );

                if (!original) {
                    continue;
                }

                allItems.push({
                    type: "text",
                    node,
                    original
                });

            }


            for (
                const item of attributes
            ) {

                allItems.push({
                    type: "attribute",
                    element: item.element,
                    attribute: item.attribute,
                    original: item.original
                });

            }


            /*
               Remove duplicate strings.
            */

            const uniqueTexts =
                Array.from(
                    new Set(
                        allItems.map(
                            item =>
                                item.original
                        )
                    )
                );


            const translationMap =
                new Map();


            /*
               Translate in batches of 10.
               Backend currently accepts max 12.
            */

            for (
                let start = 0;
                start < uniqueTexts.length;
                start += BATCH_SIZE
            ) {

                const batchTexts =
                    uniqueTexts.slice(
                        start,
                        start + BATCH_SIZE
                    );


                const batchItems =
                    batchTexts.map(
                        text => ({
                            original: text
                        })
                    );


                const translations =
                    await translateBatch(
                        batchItems,
                        language
                    );


                batchTexts.forEach(
                    (original, index) => {

                        translationMap.set(
                            original,
                            translations[index] ||
                            original
                        );

                    }
                );

            }


            /*
               Apply text translations.
            */

            for (
                const item of allItems
            ) {

                const translated =
                    translationMap.get(
                        item.original
                    );


                if (
                    !translated
                ) {
                    continue;
                }


                if (
                    item.type === "text"
                ) {

                    item.node.nodeValue =
                        translated;

                    item.node.setAttribute(
                        "data-agrosathi-translated",
                        "true"
                    );

                }


                if (
                    item.type === "attribute"
                ) {

                    item.element.setAttribute(
                        item.attribute,
                        translated
                    );

                }

            }

        } finally {

            translationRunning =
                false;

        }

    }


    /* =====================================================
       SAVE LANGUAGE TO FLASK SESSION
    ===================================================== */

    async function saveLanguage(
        language
    ) {

        try {

            await fetch(
                LANGUAGE_ENDPOINT,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    credentials: "same-origin",

                    body: JSON.stringify({
                        language
                    })
                }
            );

        } catch (error) {

            console.error(
                "Agrosathi language session error:",
                error
            );

        }

    }


    /* =====================================================
       CREATE GLOBAL SELECTOR
    ===================================================== */

    function createGlobalSelector() {

        const existing =
            document.querySelector(
                "#languageSelector, " +
                "#farmLanguage, " +
                ".language-selector"
            );


        /*
           Existing selector found.
           Do not create another.
        */

        if (existing) {

            return;

        }


        const wrapper =
            document.createElement(
                "div"
            );

        wrapper.id =
            "agrosathi-global-language";


        wrapper.innerHTML = `
            <select
                id="agrosathiLanguageSelector"
                aria-label="Select language"
            >
                <option value="en">
                    English
                </option>

                <option value="hi">
                    हिन्दी
                </option>

                <option value="mr">
                    मराठी
                </option>
            </select>
        `;


        const style =
            document.createElement(
                "style"
            );


        style.textContent = `
            #agrosathi-global-language {
                position: fixed;
                top: 18px;
                right: 18px;
                z-index: 99999;
            }

            #agrosathiLanguageSelector {
                min-width: 125px;
                padding: 9px 11px;
                border-radius: 10px;
                border: 1px solid rgba(255,255,255,.15);
                background: rgba(10,18,14,.92);
                color: #ffffff;
                font-size: 12px;
                font-weight: 700;
                cursor: pointer;
                outline: none;
                backdrop-filter: blur(10px);
            }

            #agrosathiLanguageSelector option {
                background: #ffffff;
                color: #17241b;
            }
        `;


        document.head.appendChild(
            style
        );


        document.body.appendChild(
            wrapper
        );

    }


    /* =====================================================
       GET ALL LANGUAGE SELECTORS
    ===================================================== */

    function getLanguageSelectors() {

        return Array.from(
            document.querySelectorAll(
                "#languageSelector, " +
                "#farmLanguage, " +
                ".language-selector, " +
                "#agrosathiLanguageSelector"
            )
        );

    }


    /* =====================================================
       SYNC SELECTORS
    ===================================================== */

    function syncSelectors(
        language
    ) {

        const selectors =
            getLanguageSelectors();


        selectors.forEach(
            selector => {

                selector.value =
                    language;

            }
        );

    }


    /* =====================================================
       LANGUAGE CHANGE
    ===================================================== */

    async function changeLanguage(
        language
    ) {

        if (
            !SUPPORTED_LANGUAGES[
                language
            ]
        ) {

            return;

        }


        currentLanguage =
            language;


        localStorage.setItem(
            STORAGE_KEY,
            language
        );


        syncSelectors(
            language
        );


        await saveLanguage(
            language
        );


        /*
           Restore original content
           before translating again.
        */

        restoreOriginalContent();


        await translatePage(
            language
        );

    }


    /* =====================================================
       ATTACH SELECTOR EVENTS
    ===================================================== */

    function attachSelectorEvents() {

        const selectors =
            getLanguageSelectors();


        selectors.forEach(
            selector => {

                if (
                    selector.dataset
                        .agrosathiBound ===
                    "true"
                ) {

                    return;

                }


                selector.dataset
                    .agrosathiBound =
                    "true";


                selector.addEventListener(
                    "change",
                    () => {

                        changeLanguage(
                            selector.value
                        );

                    }
                );

            }
        );


        syncSelectors(
            currentLanguage
        );

    }


    /* =====================================================
       OBSERVE DYNAMIC CONTENT
    ===================================================== */

    function setupObserver() {

        const observer =
            new MutationObserver(
                () => {

                    clearTimeout(
                        observerTimer
                    );


                    observerTimer =
                        setTimeout(
                            async () => {

                                createGlobalSelector();

                                attachSelectorEvents();


                                if (
                                    currentLanguage !==
                                    "en"
                                ) {

                                    await translatePage(
                                        currentLanguage
                                    );

                                }

                            },
                            350
                        );

                }
            );


        observer.observe(
            document.body,
            {
                childList: true,
                subtree: true
            }
        );

    }


    /* =====================================================
       INITIALIZATION
    ===================================================== */

    async function init() {

        createGlobalSelector();

        attachSelectorEvents();


        /*
           Restore to original English first.
        */

        restoreOriginalContent();


        /*
           Translate current page.
        */

        await translatePage(
            currentLanguage
        );


        /*
           Watch AI-generated / dynamic content.
        */

        setupObserver();

    }


    /* =====================================================
       START
    ===================================================== */

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            init
        );

    } else {

        init();

    }

})();