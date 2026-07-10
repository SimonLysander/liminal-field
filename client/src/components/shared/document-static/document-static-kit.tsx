import {
  BaseBlockquotePlugin,
  BaseBoldPlugin,
  BaseCodePlugin,
  BaseH1Plugin,
  BaseH2Plugin,
  BaseH3Plugin,
  BaseH4Plugin,
  BaseH5Plugin,
  BaseH6Plugin,
  BaseHighlightPlugin,
  BaseHorizontalRulePlugin,
  BaseItalicPlugin,
  BaseKbdPlugin,
  BaseStrikethroughPlugin,
  BaseSubscriptPlugin,
  BaseSuperscriptPlugin,
  BaseUnderlinePlugin,
} from '@platejs/basic-nodes';
import {
  BaseFontBackgroundColorPlugin,
  BaseFontColorPlugin,
  BaseFontFamilyPlugin,
  BaseFontSizePlugin,
} from '@platejs/basic-styles';
import {
  BaseCodeBlockPlugin,
  BaseCodeLinePlugin,
  BaseCodeSyntaxPlugin,
} from '@platejs/code-block';
import { BaseDatePlugin } from '@platejs/date';
import { BaseLinkPlugin } from '@platejs/link';
import { BaseListPlugin } from '@platejs/list';
import { BaseEquationPlugin, BaseInlineEquationPlugin } from '@platejs/math';
import { BaseCaptionPlugin } from '@platejs/caption';
import { BaseFilePlugin, BaseImagePlugin } from '@platejs/media';
import {
  BaseTableCellHeaderPlugin,
  BaseTableCellPlugin,
  BaseTablePlugin,
  BaseTableRowPlugin,
} from '@platejs/table';
import { common, createLowlight } from 'lowlight';
import { BaseParagraphPlugin } from 'platejs';

import {
  StaticBlockquoteElement,
  StaticBoldLeaf,
  StaticCaptionElement,
  StaticCodeLeaf,
  StaticDateElement,
  StaticEquationElement,
  StaticFileElement,
  StaticFontBackgroundColorLeaf,
  StaticFontColorLeaf,
  StaticFontFamilyLeaf,
  StaticFontSizeLeaf,
  StaticHeadingElement,
  StaticHighlightLeaf,
  StaticHrElement,
  StaticImageElement,
  StaticInlineEquationElement,
  StaticItalicLeaf,
  StaticKbdLeaf,
  StaticLinkElement,
  StaticListBelowNodes,
  StaticParagraphElement,
  StaticStrikethroughLeaf,
  StaticSubscriptLeaf,
  StaticSuperscriptLeaf,
  StaticTableCellElement,
  StaticTableElement,
  StaticTableRowElement,
  StaticUnderlineLeaf,
} from './document-static-components';
import {
  StaticCodeBlockElement,
  StaticCodeLineElement,
  StaticCodeSyntaxLeaf,
} from './document-static-code';

const lowlight = createLowlight(common);

export const StaticDocumentKit = [
  BaseParagraphPlugin.withComponent(StaticParagraphElement),
  BaseH1Plugin.withComponent((props) => <StaticHeadingElement {...props} variant="h1" />),
  BaseH2Plugin.withComponent((props) => <StaticHeadingElement {...props} variant="h2" />),
  BaseH3Plugin.withComponent((props) => <StaticHeadingElement {...props} variant="h3" />),
  BaseH4Plugin.withComponent((props) => <StaticHeadingElement {...props} variant="h4" />),
  BaseH5Plugin.withComponent((props) => <StaticHeadingElement {...props} variant="h5" />),
  BaseH6Plugin.withComponent((props) => <StaticHeadingElement {...props} variant="h6" />),
  BaseBlockquotePlugin.withComponent(StaticBlockquoteElement),
  BaseHorizontalRulePlugin.withComponent(StaticHrElement),
  BaseBoldPlugin.withComponent(StaticBoldLeaf),
  BaseItalicPlugin.withComponent(StaticItalicLeaf),
  BaseUnderlinePlugin.withComponent(StaticUnderlineLeaf),
  BaseStrikethroughPlugin.withComponent(StaticStrikethroughLeaf),
  BaseCodePlugin.withComponent(StaticCodeLeaf),
  BaseHighlightPlugin.withComponent(StaticHighlightLeaf),
  BaseKbdPlugin.withComponent(StaticKbdLeaf),
  BaseSubscriptPlugin.withComponent(StaticSubscriptLeaf),
  BaseSuperscriptPlugin.withComponent(StaticSuperscriptLeaf),
  BaseFontColorPlugin.withComponent(StaticFontColorLeaf),
  BaseFontBackgroundColorPlugin.withComponent(StaticFontBackgroundColorLeaf),
  BaseFontSizePlugin.withComponent(StaticFontSizeLeaf),
  BaseFontFamilyPlugin.withComponent(StaticFontFamilyLeaf),
  BaseLinkPlugin.withComponent(StaticLinkElement),
  BaseListPlugin.configure({ render: { belowNodes: StaticListBelowNodes } }),
  BaseTablePlugin.withComponent(StaticTableElement),
  BaseTableRowPlugin.withComponent(StaticTableRowElement),
  BaseTableCellPlugin.withComponent(StaticTableCellElement),
  BaseTableCellHeaderPlugin.withComponent((props) => (
    <StaticTableCellElement {...props} isHeader />
  )),
  BaseDatePlugin.withComponent(StaticDateElement),
  BaseImagePlugin.withComponent(StaticImageElement),
  BaseFilePlugin.withComponent(StaticFileElement),
  BaseCaptionPlugin.withComponent(StaticCaptionElement),
  BaseCodeBlockPlugin.configure({ options: { lowlight } }).withComponent(StaticCodeBlockElement),
  BaseCodeLinePlugin.withComponent(StaticCodeLineElement),
  BaseCodeSyntaxPlugin.withComponent(StaticCodeSyntaxLeaf),
  BaseEquationPlugin.withComponent(StaticEquationElement),
  BaseInlineEquationPlugin.withComponent(StaticInlineEquationElement),
];
