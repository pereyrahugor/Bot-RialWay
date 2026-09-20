/**
 * bat-loader.js
 * Utility for rendering the Pixel Bat (Violet Edition) loading animation.
 */
(function() {
    'use strict';

    /**
     * Generates the HTML string for the bat loader.
     * @param {string|Object} options - Text label or configuration object.
     * @param {string} [options.text='Cargando...'] - Text shown below/next to the bat. Pass null or '' for no text.
     * @param {('xs'|'sm'|'md'|'lg')} [options.size='md'] - Sizing of the bat animation.
     * @param {boolean} [options.inline=false] - Whether to display inline.
     * @param {string} [options.className=''] - Additional CSS classes.
     * @param {string} [options.style=''] - Additional inline styles.
     * @returns {string} HTML markup.
     */
    function batLoaderHtml(options) {
        let text = 'Cargando...';
        let size = 'md';
        let inline = false;
        let className = '';
        let style = '';

        if (typeof options === 'string') {
            text = options;
        } else if (options && typeof options === 'object') {
            if (options.text !== undefined) text = options.text;
            if (options.size) size = options.size;
            if (options.inline) inline = !!options.inline;
            if (options.className) className = options.className;
            if (options.style) style = options.style;
        }

        const sizeClass = size === 'xs' ? 'bat-loader-xs' : size === 'sm' ? 'bat-loader-sm' : size === 'lg' ? 'bat-loader-lg' : '';
        const inlineClass = inline ? 'inline' : '';
        const fullClass = ['bat-loader', sizeClass, inlineClass, className].filter(Boolean).join(' ');
        const styleAttr = style ? ` style="${style}"` : '';

        const labelHtml = text ? `<span class="bat-loader-text">${text}</span>` : '';

        return `<div class="${fullClass}"${styleAttr}><div class="bat-stage-wrapper"><div class="bat-stage"><div class="bat-pixel"></div></div></div>${labelHtml}</div>`;
    }

    /**
     * Helper to render the bat loader into a DOM element.
     * @param {HTMLElement|string} target - Target element or query selector.
     * @param {string|Object} options - Options for batLoaderHtml.
     */
    function renderBatLoader(target, options) {
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        if (!el) return;
        el.innerHTML = batLoaderHtml(options);
    }

    window.batLoaderHtml = batLoaderHtml;
    window.BatLoader = {
        html: batLoaderHtml,
        render: renderBatLoader
    };
})();
