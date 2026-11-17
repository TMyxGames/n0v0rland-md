import notebookCss from './themes/notebook.css?inline'
import homepageCss from './hosts/homepage/homepage.css?inline'
import homepageEditorCss from './hosts/homepage/editor-bridge.css?inline'

/** Host configuration, independent of the parser and editor's document model.
 * Styles are trusted application assets, not CSS accepted from article content.
 */
export interface PlaygroundTheme {
  id: string
  label: string
  className: string
  css: string
}

export const playgroundThemes: PlaygroundTheme[] = [
  { id: 'classic', label: '经典', className: '', css: '' },
  { id: 'notebook', label: '纸笺', className: 'mde-notebook', css: notebookCss },
  { id: 'homepage', label: '主站 BDmarkdown', className: 'mde-homepage', css: homepageCss + '\n' + homepageEditorCss },
]
