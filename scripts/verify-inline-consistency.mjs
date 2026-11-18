import assert from 'node:assert/strict'
import { createMarkdownItPreset, createSiteMarkdown, expressionSyntax } from '../packages/preset/dist/index.js'
import { inlineSyntaxPlugin, bracketSyntaxParts } from '../packages/markdown-it-adapter/dist/index.js'

const site = createSiteMarkdown()
const normal = createMarkdownItPreset()
const configured = createMarkdownItPreset({ configure: md => md.use(inlineSyntaxPlugin, expressionSyntax) })
const parsers = [configured, site.md, site.commentMd]
for (const md of [normal, ...parsers]) {
  for (const source of ['***粗斜体***', '**粗体 *斜体* 粗体**', '*斜体 **粗体** 斜体*']) {
    const tokens = md.parseInline(source, {})[0].children
    assert.ok(tokens.some(token => token.type === 'strong_open'))
    assert.ok(tokens.some(token => token.type === 'em_open'))
    assert.match(md.render(source), /<em>/)
    assert.match(md.render(source), /<strong>/)
  }
}
assert.doesNotMatch(normal.render('::loud[**粗**]'), /bd-markdown-loud/)
for (const md of parsers) {
  for (const name of ['loud', 'whisper', 'inner']) {
    for (const content of ['**粗**', '*斜*', '++线++', '***粗斜***', '~~删除~~', '`代码`']) {
      const source = `::${name}[${content}]`
      const token = md.parseInline(source, {})[0].children[0]
      assert.equal(token.type, 'mapped_inline_syntax')
      assert.equal(token.meta.sourceFrom, 0)
      assert.equal(token.meta.sourceTo, source.length)
      assert.ok(token.children.length > 0)
      assert.equal(bracketSyntaxParts(source).body, content)
      assert.match(md.render(source), /bd-markdown-/)
    }
  }
  assert.match(md.render('::loud[外 ::whisper[**内**] 尾]'), /bd-markdown-whisper.*<strong>/)
  assert.match(md.render('**外 ::inner[*内*] 尾**'), /<strong>.*bd-markdown-inner-thought.*<em>/)
  assert.match(md.render('::raw[**原文** ::loud[不生效]]'), />\*\*原文\*\* ::loud\[不生效\]<\/span>/)
  assert.doesNotMatch(md.render('::raw[**原文**]'), /<strong>/)
  for (const source of ['::loud[]', '::loud[未闭合', '\\::loud[转义]', '::loud[跨\n行]']) {
    assert.doesNotMatch(md.render(source), /bd-markdown-loud/)
  }
  assert.match(md.render('::LOUD[大写]'), /bd-markdown-loud/)
  assert.match(md.render('::no parse[*原文*]'), />\*原文\*<\/span>/)
  assert.match(md.render('::loud[转义 \\] **粗体**]'), /<strong>/)
  assert.match(md.render('::loud[`]` **粗**]'), /<code>]<\/code>/)
  assert.doesNotMatch(md.render('`::loud[代码]`'), /bd-markdown-loud/)
  assert.doesNotMatch(md.render('::loud[<img src=x onerror=alert(1)>]'), /<img/)
}
assert.doesNotMatch(site.renderCommentMarkdown('::raw[||隐藏原文||]'), /class="bd-markdown-theme-spoiler"/)
assert.doesNotMatch(site.renderCommentMarkdown('`||代码||`'), /class="bd-markdown-theme-spoiler"/)
assert.match(site.renderCommentMarkdown('||隐藏内容||'), /class="bd-markdown-theme-spoiler"/)
assert.match(site.renderCommentMarkdown('前文 ||隐藏内容||'), /class="bd-markdown-theme-spoiler"/)
assert.match(site.md.render('前文 ||隐藏内容||'), /class="bd-markdown-theme-spoiler"/)
assert.match(site.md.render('**前文** ||隐藏内容||'), /<strong>.*前文.*<\/strong>.*bd-markdown-theme-spoiler/s)
assert.match(site.renderCommentMarkdown('*前文* ||隐藏内容||'), /<em>.*前文.*<\/em>.*bd-markdown-theme-spoiler/s)
assert.match(site.renderCommentMarkdown('||隐藏 *保持纯文本*||'), /隐藏 \*保持纯文本\*/)
assert.match(site.renderCommentMarkdown('::inner[***粗斜体***]'), /<em><strong>/)
console.log('PASS: authoritative inline tokens, nested expressions, raw, escapes, incomplete syntax, standard emphasis and comment rendering')
