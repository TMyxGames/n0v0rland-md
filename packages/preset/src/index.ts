// The renderer contains intentionally dynamic markdown-it extension callbacks.
// Keep its runtime behavior unchanged while the surrounding utilities migrate.
// @ts-nocheck
import MarkdownIt from 'markdown-it';
import tocPlugin from 'markdown-it-toc-done-right';
import anchor from 'markdown-it-anchor'; // 标题锚点
import mark from 'markdown-it-mark'; // 代码
import ins from 'markdown-it-ins'; // 下划线
import hljs from 'highlight.js'; // 高亮
import { full as emoji } from 'markdown-it-emoji'; // 表情
import markdownItTaskLists from 'markdown-it-task-lists'; // 任务列表
import markdownItFootnote from 'markdown-it-footnote';
import container from 'markdown-it-container'; // 自定义容器


export interface MarkdownPresetOptions {
    siteOrigin?: string;
    configure?: (markdown: MarkdownIt, commentMarkdown: MarkdownIt) => void;
}

export function createSiteMarkdown(options: MarkdownPresetOptions = {}) {
const md = new MarkdownIt({
    // 用户文章正文会通过 v-html 挂载；禁止 Markdown 原始 HTML，避免
    // <script>、事件属性、iframe 等内容形成存储型 XSS。
    // 站内自定义扩展仍由 renderer 生成受控 HTML，不依赖此开关。
    html: false,
    linkify: true,
    typographer: true,
    highlight: function (str, lang) {
        if (lang && hljs.getLanguage(lang)) {
        try {
            // 使用 highlight.js 染色
            return '<pre class="hljs"><code>' +
                hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
                '</code></pre>';
        } catch (__) {}
        }
        return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
    },

});

// markdown-it/linkify-it 默认会把裸域名补成 http://。本站外链默认优先使用
// HTTPS；用户明确写出的 http:// 仍然保留，避免改变其原始链接意图。
const preferHttpsForBareLinks = (linkify: any) => {
    const defaultNormalize = linkify.normalize.bind(linkify);
    linkify.normalize = (match: any) => {
        defaultNormalize(match);
        if (!match.schema && /^http:\/\//i.test(match.url)) {
            match.url = `https://${match.url.slice('http://'.length)}`;
        }
    };
};

md.linkify.tlds(['xyz'], true);
preferHttpsForBareLinks(md.linkify);

// 正文与评论共用站内文章识别，避免两处的链接图标行为不一致。
const articleBloomIdFromUrl = (value: string) => {
    try {
        const origin = options.siteOrigin || 'https://localhost.invalid';
        const url = new URL(value, origin);
        if (url.hostname.replace(/^www\./, '') !== new URL(origin).hostname.replace(/^www\./, '')) return '';
        return decodeURIComponent(url.pathname.match(/^\/note\/([^/]+)/i)?.[1] || '');
    } catch { return ''; }
};const linkIcon = kind => `<span class="bd-link-icon bd-link-icon-${kind}" aria-hidden="true"></span>`;
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const kind = articleBloomIdFromUrl(token.attrGet('href') || '') ? 'article' : 'external';
    token.attrSet('data-markdown-link', 'true');
    token.attrSet('data-link-kind', kind);
    return `${self.renderToken(tokens, idx, options)}${linkIcon(kind)}`;
};
md.renderer.rules.link_close = (tokens, idx, options, env, self) => {
    const previous = tokens[idx - 1];
    if (previous?.type === 'link_open') {
        const href = previous.attrGet('href') || '';
        return `${md.utils.escapeHtml(href)}</a>`;
    }
    return self.renderToken(tokens, idx, options);
};

md.use(mark);
md.use(ins);
md.use(emoji)
md.use(markdownItTaskLists);
md.use(markdownItFootnote);
// 首字下沉容器曾使用 ↓↓↓ 标记，后来统一为三连反引号。文章内容存储在
// 服务端后不会随前端升级自动迁移，因此这里同时保留两种语法的解析入口，
// 并始终输出同一个 .bd-dropcap 结构，避免历史文章在生产环境中失去样式。
const dropcapContainer = {
    render(tokens, idx) {
        return tokens[idx].nesting === 1
            ? '<div class="bd-dropcap">'
            : '</div>\n';
    },
};

md.use(container, 'dropcap', {
    marker: '`',
    ...dropcapContainer,
});

md.use(container, 'dropcap_legacy', {
    marker: '↓',
    validate: params => params.trim().split(' ', 2)[0] === 'dropcap',
    ...dropcapContainer,
});

// “不解析”需要在 Markdown block/tokenize 之前截取内容，否则其中的
// 标题、强调、链接等语法已经被 markdown-it 转换，无法再恢复原文。
const noParseBlock = (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const opening = state.src.slice(start, max).match(/^:::\s*(不解析|no[ -]?parse)\s*$/i);
    if (!opening) return false;
    if (silent) return true;

    let nextLine = startLine + 1;
    for (; nextLine < endLine; nextLine += 1) {
        const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
        const lineEnd = state.eMarks[nextLine];
        if (/^:::\s*$/.test(state.src.slice(lineStart, lineEnd))) break;
    }
    if (nextLine >= endLine) return false;

    const token = state.push('no_parse_block', 'div', 0);
    token.block = true;
    token.content = state.getLines(startLine + 1, nextLine, state.blkIndent, true);
    token.map = [startLine, nextLine + 1];
    state.line = nextLine + 1;
    return true;
};

md.block.ruler.before('fence', 'no_parse_block', noParseBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
});

md.renderer.rules.no_parse_block = tokens => {
    const content = md.utils.escapeHtml(tokens[0].content);
    return `<div class="bd-markdown-no-parse"><pre><code>${content}</code></pre></div>\n`;
};

// Inline custom marks: ::小声哔哔[内容] / ::whisper[内容] / ::内心活动[内容]
md.inline.ruler.before('text', 'inline_custom_marks', (state, silent) => {
    const match = state.src.slice(state.pos).match(/^::(whisper|loud|inner|不解析|no[ -]?parse|raw)\[([^\]\n]+)\]/i);
    if (!match) return false;
    if (!silent) {
        const isNoParse = /^(不解析|no[ -]?parse|raw)$/i.test(match[1]);
        const className = isNoParse
            ? 'bd-markdown-no-parse-inline'
            : /inner/i.test(match[1]) ? 'bd-markdown-inner-thought' : /loud/i.test(match[1]) ? 'bd-markdown-loud' : 'bd-markdown-whisper';
        const token = state.push('html_inline', '', 0);
        token.content = `<span class="${className}">${state.md.utils.escapeHtml(match[2])}</span>`;
        token.meta = {
            sourceFrom: state.pos,
            sourceTo: state.pos + match[0].length,
            syntaxKind: match[1].toLowerCase(),
        };
    }
    state.pos += match[0].length;
    return true;
});
md.use(anchor, {
    permalink: false, // 我们不需要在标题后显示链接符号
    slugify: (s) => encodeURIComponent(String(s).trim().toLowerCase().replace(/\s+/g, '-')) 
    // 确保中文标题也能生成合法的 ID
});

md.use(tocPlugin, {
    containerClass: 'bd-markdown-theme toc-container',
    listType: 'ul',
    format: (content) => `<span>${content}</span>`,
});

md.core.ruler.after('block', 'markdown_alerts', state => {
    const supported = new Set(['note', 'tip', 'important', 'warning', 'caution']);
    state.tokens.forEach((token, index) => {
        if (token.type !== 'blockquote_open') return;
        const inline = state.tokens[index + 2];
        if (!inline || inline.type !== 'inline') return;
        const match = inline.content.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i);
        if (!match) return;
        const type = match[1].toLowerCase();
        if (!supported.has(type)) return;
        token.attrJoin('class', `markdown-alert markdown-alert-${type}`);
        inline.content = inline.content.slice(match[0].length);
        const firstText = inline.children?.find(child => child.type === 'text');
        if (firstText) firstText.content = firstText.content.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, '');
    });
});

const alertMeta = {
    note: {
        label: 'Note',
        icon: '<span class="markdown-alert-icon" aria-hidden="true"></span>',
    },
    tip: {
        label: 'Tip',
        icon: '<span class="markdown-alert-icon" aria-hidden="true"></span>',
    },
    important: {
        label: 'Important',
        icon: '<span class="markdown-alert-icon" aria-hidden="true"></span>',
    },
    warning: {
        label: 'Warning',
        icon: '<span class="markdown-alert-icon" aria-hidden="true"></span>',
    },
    caution: {
        label: 'Caution',
        icon: '<span class="markdown-alert-icon" aria-hidden="true"></span>',
    },
};

const defaultBlockquoteOpen = md.renderer.rules.blockquote_open
    || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.blockquote_open = (tokens, idx, options, env, self) => {
    const opening = defaultBlockquoteOpen(tokens, idx, options, env, self);
    const classes = tokens[idx].attrGet('class') || '';
    const type = Object.keys(alertMeta).find(name => classes.includes(`markdown-alert-${name}`));
    if (!type) return opening;

    const meta = alertMeta[type];
    return `${opening}<div class="markdown-alert-title">${meta.icon}<span>${meta.label}</span></div>`;
};

// 自定义规则
md.renderer.rules.h1_open = () => '<h1><span>';
md.renderer.rules.h1_close = () => '</span></h1>';

md.renderer.rules.h2_open = () => '<h2><span>';
md.renderer.rules.h2_close = () => '</span></h2>';

md.renderer.rules.h3_open = () => '<h3><span>';
md.renderer.rules.h3_close = () => '</span></h3>';

md.renderer.rules.h4_open = () => '<h4><span>';
md.renderer.rules.h4_close = () => '</span></h4>';

md.renderer.rules.h5_open = () => '<h5><span>';
md.renderer.rules.h5_close = () => '</span></h5>';

md.renderer.rules.h6_open = () => '<h6><span>';
md.renderer.rules.h6_close = () => '</span></h6>';

md.renderer.rules.strong_open = () => '<strong><span>';
md.renderer.rules.strong_close = () => '</span></strong>';

md.renderer.rules.ins_open = () => '<u>';
md.renderer.rules.ins_close = () => '</u>';

// md.renderer.rules.a_open = () => '<a href="' + token.attrGet('href') + '" target="_blank" rel="noopener noreferrer">';
// md.renderer.rules.a_close = () => '</a>';

md.renderer.rules.table_open = () => '<div class="bd-markdown-theme-table-wrapper"><table>';
md.renderer.rules.table_close = () => '</table></div>';

md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const language = token.info.trim().split(/\s+/)[0].toLowerCase();
    if (language === 'mermaid') {
        return `<div class="bd-mermaid"><pre class="mermaid">${md.utils.escapeHtml(token.content)}</pre></div>`;
    }

    const safeLanguage = language.replace(/[^a-z0-9_-]/gi, '');
    const sourceLines = token.content.replace(/\n$/, '').split('\n');
    const lines = sourceLines.map(line => {
        if (safeLanguage && hljs.getLanguage(safeLanguage)) {
            try {
                return hljs.highlight(line, { language: safeLanguage, ignoreIllegals: true }).value;
            } catch (__) {
                return md.utils.escapeHtml(line);
            }
        }
        return md.utils.escapeHtml(line);
    });
    const renderedLines = lines.map((line, index) => (
        `<span class="bd-code-line"><span class="bd-code-line-number" aria-hidden="true">${index + 1}</span><span class="bd-code-line-content">${line || '<br>'}</span></span>`
    )).join('');
    const languageClass = safeLanguage ? ` language-${safeLanguage}` : '';

    return `<div class="bd-code-block"><button class="bd-code-copy" type="button" aria-label="复制代码"><svg class="bd-code-copy-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg><svg class="bd-code-check-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></button><pre class="hljs"><code class="${languageClass.trim()}">${renderedLines}</code></pre></div>`;
};

const defaultRender = md.renderer.rules.image || function(tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
};

md.renderer.rules.image = function (tokens, idx, options, env, self) {
    const token = tokens[idx];
    const src = token.attrGet('src') || '';
    const caption = md.utils.escapeHtml(token.content); // 提取 alt 文字作为说明

    const sizeMatch = src.match(/#(\d+)x(\d+)$/);
    let styleVars = '';
    let pureSrc = src;

    if (sizeMatch) {
        const width = sizeMatch[1];
        const height = sizeMatch[2];
        pureSrc = src.split('#')[0]; // 去掉后缀，得到真实图片地址
        styleVars = `style="--img-w: ${width}; --img-h: ${height};"`;
    } else {
        styleVars = '';
    }

    const highSrc = pureSrc;
    const highFileName = highSrc.split('/').pop() || '';
    const isDirect = highSrc.includes('/images/high/') && /-direct\.[^./?#]+(?:[?#].*)?$/i.test(highSrc);
    const lowFileName = highFileName.replace(/\.[^./?#]+(?=([?#].*)?$)/, '.webp');
    const lowSrc = highSrc.includes('/images/high/') && !isDirect
        ? highSrc.replace('/images/high/' + highFileName, '/images/low/' + lowFileName)
        : highSrc;
    const safeHighSrc = md.utils.escapeHtml(highSrc);
    const safeLowSrc = md.utils.escapeHtml(lowSrc);
    const hasHighVariant = lowSrc !== highSrc;

    const retryScript = `
        // 初始化重试计数
        if (!this.dataset.retry) {
            this.dataset.retry = 0;
        }
        if (this.dataset.retry < 3) {
            this.dataset.retry++;
            
            this.style.opacity = 0.5;
            console.warn(\`图片加载失败，正在进行第 \${this.dataset.retry} 次重试...\`);

            // 阶梯式延迟触发重试 (2s, 4s, 6s)
            setTimeout(() => {
                const url = new URL(this.src);
                
                // 更新 URL 参数打破缓存，强制向 CDN 重新发起请求
                url.searchParams.set('retry', this.dataset.retry);
                this.src = url.toString();
            }, this.dataset.retry * 2000);

        } else {
            // 重试3次失败后，恢复透明度并加入错误类
            this.style.opacity = 1;
            this.classList.add('img-load-failed');
            console.error('图片重试3次依然失败，停止加载。');
        }
    `;

    // 返回带有 figure 和 figcaption 的结构
    return `
        <figure class="bd-md-figure">
            <img src="${safeLowSrc}"
                 alt="${caption}" 
                 ${styleVars}
                 data-retry="0" 
                 onerror="${retryScript.replace(/\s+/g, ' ')}"
                 loading="lazy" 
                 decoding="async"
                 class="bd-md-clickable-image"
                 data-src="${safeHighSrc}"
                 ${hasHighVariant ? `data-high-src="${safeHighSrc}"` : ''} />
            <figcaption class="bd-md-caption">${caption}</figcaption>
        </figure>
    `.trim();
};

const proxy = (tokens, idx, options, env, self) => self.renderToken(tokens, idx, options);
const defaultHeadingOpen = md.renderer.rules.heading_open || proxy;

const renderAnchorLink = (id, label) => id
    ? `<button class="bd-anchor-link" type="button" data-anchor-id="${md.utils.escapeHtml(id)}" aria-label="${label}"></button>`
    : '';

md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const idIndex = token.attrIndex('id');
    let idAttr = '';
    if (idIndex >= 0) {
        idAttr = ` id="${token.attrs[idIndex][1]}"`;
    }
    const anchorLink = renderAnchorLink(token.attrGet('id'), '链接到此标题');

    if (token.tag === 'h1') {
        return `<h1${idAttr} class="bd-anchor-target">${anchorLink}<span>`;
    }
    if (token.tag === 'h2') {
        return `<h2${idAttr} class="bd-anchor-target">${anchorLink}<span>`;
    }
    if (token.tag === 'h3') {
        return `<h3${idAttr} class="bd-anchor-target">${anchorLink}<span>`;
    }
    if (token.tag === 'h4') {
        return `<h4${idAttr} class="bd-anchor-target">${anchorLink}<span>`;
    }
    if (token.tag === 'h5') {
        return `<h5${idAttr} class="bd-anchor-target">${anchorLink}<span>`;
    }
    if (token.tag === 'h6') {
        return `<h6${idAttr} class="bd-anchor-target">${anchorLink}<span>`;
    }

    return defaultHeadingOpen(tokens, idx, options, env, self);
};

md.renderer.rules.heading_close = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token.tag === 'h1') {
        return '</span></h1>';
    }
    if (token.tag === 'h2') {
        return '</span></h2>';
    }
    if (token.tag === 'h3') {
        return '</span></h3>';
    }
    if (token.tag === 'h4') {
        return '</span></h4>';
    }
    if (token.tag === 'h5') {
        return '</span></h5>';
    }
    if (token.tag === 'h6') {
        return '</span></h6>';
    }

    return self.renderToken(tokens, idx, options);
};

md.inline.ruler.before('text', 'spoiler', (state, silent) => {
    const src = state.src;
    const start = state.pos;
    const max = state.posMax;

    if (start + 5 > max) return false;

    if (src.charCodeAt(start) !== 124 || src.charCodeAt(start + 1) !== 124) {
        return false;
    }

    let end = -1;
    for (let i = start + 2; i < max - 1; i++) {
        if (src.charCodeAt(i) === 124 && src.charCodeAt(i + 1) === 124) {
            end = i;
            break;
        }
    }

    if (end === -1 || end === start + 2) return false;

    if (!silent) {
        // 标记开始标签
        const tokenOpen = state.push('spoiler_open', 'span', 1);
        tokenOpen.attrs = [['class', 'bd-markdown-theme-spoiler']];
        // 限制解析范围，只处理 || 和 || 之间的内容
        const oldMax = state.posMax;
        state.pos = start + 2;
        state.posMax = end;
        // 进行行内 Token 化（支持嵌套加粗、斜体等）
        state.md.inline.tokenize(state);
        // 恢复环境
        state.posMax = oldMax;
        // 标记结束标签
        state.push('spoiler_close', 'span', -1);
    }

    state.pos = end + 2;
    return true;
});

md.inline.ruler.before('text', 'color_swatch', (state, silent) => {
    const src = state.src;
    const pos = state.pos;

    if (!src.startsWith('@color(', pos)) return false;

    const start = pos + 7;
    const end = src.indexOf(')', start);
    if (end === -1) return false;

    if (!silent) {
        const content = src.slice(start, end);
        // 解析参数：[颜色, 标签?, 尺寸?]
        const parts = content.split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));
        
        const color = parts[0];
        // 如果第二个参数是 'lg' 或 'sm'，说明它跳过了标签直接写了尺寸
        const hasSizeOnly = ['l', 's'].includes(parts[1]);
        const label = hasSizeOnly ? '' : (parts[1] || '');
        const size = hasSizeOnly ? parts[1] : (parts[2] || 's');

        const token = state.push('html_inline', '', 0);
        
        // 根据是否有 label 决定是否渲染 span.swatch-label
        const labelHtml = label ? `<code class="swatch-label">${label}</code>` : '';
        
        token.content = `
        <span class="bd-md-color-swatch is-${size} ${label ? 'has-label' : 'no-label'}" title="${color}">
            <span class="swatch-box" style="background-color: ${color};"></span>
            ${labelHtml}
        </span>`.trim();
    }

    state.pos = end + 1;
    return true;
});

const commentMd = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });
commentMd.use(ins);
commentMd.linkify.tlds(['xyz'], true);
preferHttpsForBareLinks(commentMd.linkify);
commentMd.disable(['heading', 'lheading', 'blockquote', 'list', 'hr', 'table', 'html_block', 'link', 'image', 'autolink']);

commentMd.inline.ruler.before('text', 'comment_spoiler', (state, silent) => {
    const start = state.pos;
    if (!state.src.startsWith('||', start)) return false;
    const end = state.src.indexOf('||', start + 2);
    if (end <= start + 2) return false;
    if (!silent) {
        const token = state.push('html_inline', '', 0);
        token.content = `<span class="bd-markdown-theme-spoiler" tabindex="0">${state.md.utils.escapeHtml(state.src.slice(start + 2, end))}</span>`;
    }
    state.pos = end + 2;
    return true;
});

commentMd.inline.ruler.before('text', 'comment_custom_marks', (state, silent) => {
    const match = state.src.slice(state.pos).match(/^::(whisper|loud|inner|不解析|no[ -]?parse|raw)\[([^\]\n]+)\]/i);
    if (!match) return false;
    if (!silent) {
        const isNoParse = /^(不解析|no[ -]?parse|raw)$/i.test(match[1]);
        const className = isNoParse
            ? 'bd-markdown-no-parse-inline'
            : /inner/i.test(match[1]) ? 'bd-markdown-inner-thought' : /loud/i.test(match[1]) ? 'bd-markdown-loud' : 'bd-markdown-whisper';
        const token = state.push('html_inline', '', 0);
        token.content = `<span class="${className}">${state.md.utils.escapeHtml(match[2])}</span>`;
    }
    state.pos += match[0].length;
    return true;
});

commentMd.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const href = token.attrGet('href') || '';
    const bloomId = articleBloomIdFromUrl(href);
    token.attrSet('data-comment-link', 'true');
    token.attrSet('data-link-kind', bloomId ? 'article' : 'external');
    token.attrSet('rel', 'noopener noreferrer');
    return `${self.renderToken(tokens, idx, options)}${linkIcon(bloomId ? 'article' : 'external')}`;
};
commentMd.renderer.rules.strong_open = () => '<strong><span>';
commentMd.renderer.rules.strong_close = () => '</span></strong>';
commentMd.renderer.rules.ins_open = () => '<u>';
commentMd.renderer.rules.ins_close = () => '</u>';

commentMd.renderer.rules.fence = (tokens, idx) => {
    const lines = commentMd.utils.escapeHtml(tokens[idx].content).replace(/\n$/, '').split('\n');
    const content = lines.map((line, lineIndex) => `<span class="bd-code-line"><span class="bd-code-line-number" aria-hidden="true">${lineIndex + 1}</span><span class="bd-code-line-content">${line || '<br>'}</span></span>`).join('');
    return `<div class="bd-code-block"><pre class="hljs"><code>${content}</code></pre></div>`;
};

const renderCommentMarkdown = value => {
    const spoilers = [];
    const source = String(value || '').replace(/\|\|([^|\n]+)\|\|/g, (_, content) => {
        const index = spoilers.push(content) - 1;
        return `COMMENTSP${index}TOKEN`;
    });
    return commentMd.render(source).replace(/COMMENTSP(\d+)TOKEN/g, (_, index) => (
        `<span class="bd-markdown-theme-spoiler" tabindex="0">${commentMd.utils.escapeHtml(spoilers[Number(index)] || '')}</span>`
    )).replace(/(<a[^>]*data-link-kind="article"[^>]*>)(.*?)(<\/a>)/gi, (_, open, text, close) => {
        const href = open.match(/href="([^"]+)"/i)?.[1] || '';
        const icon = text.match(/<span class="bd-link-icon[^>]*><\/span>/i)?.[0] || linkIcon('article');
        return `${open}${icon}${commentMd.utils.escapeHtml(articleBloomIdFromUrl(href))}${close}`;
    });
};

options.configure?.(md, commentMd);
return { md, commentMd, renderCommentMarkdown };
}

export function createMarkdownItPreset(options: MarkdownPresetOptions = {}) {
    return createSiteMarkdown(options).md;
}

