export interface ScriptureVerse {
  readonly text: string;
  readonly reference: string;
}

/**
 * Owner-directed KJV scripture library (2026-10-27).
 *
 * Every quotation was checked against the King James Version text. Keep the
 * wording verbatim; never paraphrase or invent a reference. The public
 * presentation is the shared Scripture component.
 */
export const scriptures = {
  work: {
    text: 'Commit thy works unto the LORD, and thy thoughts shall be established.',
    reference: 'Proverbs 16:3',
  },
  service: {
    text: 'With good will doing service, as to the Lord, and not to men:',
    reference: 'Ephesians 6:7',
  },
  glory: {
    text: 'Whether therefore ye eat, or drink, or whatsoever ye do, do all to the glory of God.',
    reference: '1 Corinthians 10:31',
  },
  hospitality: {
    text: 'Distributing to the necessity of saints; given to hospitality.',
    reference: 'Romans 12:13',
  },
  integrity: {
    text: 'A false balance is abomination to the LORD: but a just weight is his delight.',
    reference: 'Proverbs 11:1',
  },
  stewardship: {
    text: 'As every man hath received the gift, even so minister the same one to another, as good stewards of the manifold grace of God.',
    reference: '1 Peter 4:10',
  },
  kindness: {
    text: 'But to do good and to communicate forget not: for with such sacrifices God is well pleased.',
    reference: 'Hebrews 13:16',
  },
  humility: {
    text: 'Let nothing be done through strife or vainglory; but in lowliness of mind let each esteem other better than themselves. Look not every man on his own things, but every man also on the things of others.',
    reference: 'Philippians 2:3-4',
  },
  excellence: {
    text: 'Seest thou a man diligent in his business? he shall stand before kings; he shall not stand before mean men.',
    reference: 'Proverbs 22:29',
  },
  light: {
    text: 'Let your light so shine before men, that they may see your good works, and glorify your Father which is in heaven.',
    reference: 'Matthew 5:16',
  },
  workmanship: {
    text: 'And let the beauty of the LORD our God be upon us: and establish thou the work of our hands upon us; yea, the work of our hands establish thou it.',
    reference: 'Psalm 90:17',
  },
} as const satisfies Record<string, ScriptureVerse>;

export type ScriptureId = keyof typeof scriptures;
