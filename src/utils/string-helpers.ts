/**
 * Utilitaires de manipulation de chaînes de caractères.
 *
 * Fonctions pures sans dépendances pour le traitement courant
 * des chaînes : capitalisation, slugification, troncature.
 */

/**
 * Met en majuscule la première lettre d'une chaîne.
 *
 * @param str - The input string to capitalize
 * @returns The string with its first character uppercased
 *
 * @example
 * capitalize('hello')   // 'Hello'
 * capitalize('')        // ''
 * capitalize(null as any) // ''
 */
export function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convertit une chaîne en slug URL-friendly.
 *
 * Transforme en minuscules, remplace les espaces et caractères
 * spéciaux par des tirets, et supprime les tirets en doublon
 * ainsi qu'en début/fin de chaîne.
 *
 * @param str - The input string to slugify
 * @returns A lowercase, hyphen-separated, URL-safe string
 *
 * @example
 * slugify('Hello World!')        // 'hello-world'
 * slugify('  Foo  BAR  baz  ')   // 'foo-bar-baz'
 * slugify('crème brûlée')        // 'creme-brulee'
 */
export function slugify(str: string): string {
  if (!str) return '';

  return str
    .normalize('NFD')                   // Decompose accented characters
    .replace(/[\u0300-\u036f]/g, '')    // Strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')       // Replace non-alphanumeric runs with hyphen
    .replace(/^-+|-+$/g, '');           // Trim leading/trailing hyphens
}

/**
 * Tronque une chaîne à une longueur maximale avec ellipsis.
 *
 * Si la chaîne est plus courte ou égale à `maxLen`, elle est
 * retournée telle quelle. Sinon, elle est coupée et terminée
 * par « ... » (les 3 points comptent dans `maxLen`).
 *
 * @param str - The input string to truncate
 * @param maxLen - Maximum allowed length (including the ellipsis)
 * @returns The original or truncated string
 *
 * @example
 * truncate('Hello World', 5)  // 'He...'
 * truncate('Hi', 10)          // 'Hi'
 * truncate('', 5)             // ''
 */
export function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  if (maxLen < 0) return '';
  if (str.length <= maxLen) return str;
  if (maxLen <= 3) return '.'.repeat(maxLen);

  return str.slice(0, maxLen - 3) + '...';
}
