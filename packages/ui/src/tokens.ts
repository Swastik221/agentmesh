/**
 * AgentMesh design tokens.
 *
 * Flat, dark, blockchain-explorer aesthetic. No gradients, shadows or glows —
 * borders alone carry separation. Accents are semantic: each colour has one
 * meaning and is never used decoratively.
 */
export const colors = {
  /** Page background. */
  base: '#0a0e17',
  /** Card / node / panel background. */
  surface: '#0d1117',
  /** The only separator we use: 1px, no shadow. */
  border: '#232c40',

  /** connected / success / claimed */
  success: '#3ddc97',
  /** active data flow, edges */
  flow: '#22d3ee',
  /** pending / auto-assigned */
  warning: '#f0b458',
  /** identity, wallet, ENS */
  identity: '#a78bfa',
  /**
   * Only used for the left-most macOS window dot, which is red by convention.
   * Not part of the semantic accent set — never use it to convey state.
   */
  windowClose: '#e5534b',

  text: '#e6edf3',
  textMuted: '#8b98ad',
  textDim: '#5c6a82',
} as const;

export type ColorToken = keyof typeof colors;
