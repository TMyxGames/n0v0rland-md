// Bundled, trusted SVG assets. Hosts can still override the toolbar tool slot.
import bold from './assets/icons/material-symbols--format-bold-rounded.svg?raw'
import italic from './assets/icons/material-symbols--format-italic-rounded.svg?raw'
import underline from './assets/icons/material-symbols--format-underlined-rounded.svg?raw'
import strike from './assets/icons/majesticons--strike-through.svg?raw'
import code from './assets/icons/material-symbols--code-xml-rounded.svg?raw'
import heading from './assets/icons/material-symbols--format-h1-rounded.svg?raw'
import blockquote from './assets/icons/material-symbols--format-quote-rounded.svg?raw'
import table from './assets/icons/mdi--table.svg?raw'
import codeBlock from './assets/icons/material-symbols--code-blocks-outline-rounded.svg?raw'
import link from './assets/icons/material-symbols--link-2-rounded.svg?raw'
import bulletList from './assets/icons/material-symbols--format-list-bulleted-rounded.svg?raw'
import orderedList from './assets/icons/material-symbols--format-list-numbered-rounded.svg?raw'
import spoiler from './assets/icons/material-symbols--visibility-off-outline-rounded.svg?raw'
import raw from './assets/icons/material-symbols--format-clear-rounded.svg?raw'
import loud from './assets/icons/material-symbols--volume-up-rounded.svg?raw'
import whisper from './assets/icons/material-symbols--volume-down-rounded.svg?raw'
import inner from './assets/icons/boxicons--thought-bubble.svg?raw'
import alignLeft from './assets/icons/material-symbols--format-align-left-rounded.svg?raw'
import alignCenter from './assets/icons/material-symbols--format-align-center-rounded.svg?raw'
import alignRight from './assets/icons/material-symbols--format-align-right-rounded.svg?raw'
import columnBefore from './assets/icons/mdi--table-column-plus-before.svg?raw'
import columnAfter from './assets/icons/mdi--table-column-plus-after.svg?raw'
import columnRemove from './assets/icons/mdi--table-column-remove.svg?raw'
import rowBefore from './assets/icons/mdi--table-row-plus-before.svg?raw'
import rowAfter from './assets/icons/mdi--table-row-plus-after.svg?raw'
import rowRemove from './assets/icons/mdi--table-row-remove.svg?raw'
import h1 from './assets/icons/material-symbols--format-h1-rounded.svg?raw'
import h2 from './assets/icons/material-symbols--format-h2-rounded.svg?raw'
import h3 from './assets/icons/material-symbols--format-h3-rounded.svg?raw'
import h4 from './assets/icons/material-symbols--format-h4-rounded.svg?raw'
import h5 from './assets/icons/material-symbols--format-h5-rounded.svg?raw'
import h6 from './assets/icons/material-symbols--format-h6-rounded.svg?raw'

export const markdownIcons: Record<string, string> = {
  bold, italic, underline, strike, code, heading, blockquote, table, codeBlock, link, bulletList, orderedList, spoiler, raw, loud, whisper, inner, alignLeft, alignCenter, alignRight, columnBefore, columnAfter, columnRemove, rowBefore, rowAfter, rowRemove, h1, h2, h3, h4, h5, h6,
  alert: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2 1 22h22L12 2zm-1 7h2v6h-2V9zm0 8h2v2h-2v-2z"/></svg>',
  mermaid: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M8 3h8v5H8zM2 16h8v5H2zm12 0h8v5h-8zM12 8v4m-6 4v-4h12v4"/></svg>',
}
