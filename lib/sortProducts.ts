/**
 * Hierarchical product sorting utility.
 * 
 * Sorts products by their position prefix (e.g., "poz 1", "poz 1.1", "poz 2.a")
 * in a structured hierarchy:
 *   poz 1 → poz 1.1 → poz 1.2 → poz 1.a → poz 2 → poz 2.1 → poz 10 → Alphabetical rest
 * 
 * Products without a position prefix are sorted alphabetically after positioned ones.
 */

// Match common position patterns at the start of the name:
// "poz 1", "poz 1.1", "poz 1.a", "Poz. 2", "POZ 10.2.b", "1.", "1.1", etc.
const POSITION_REGEX = /^(?:poz\.?\s*)?(\d+(?:\.\s*[\da-zA-ZčćšžđČĆŠŽĐ]+)*)/i;

interface PositionSegment {
    type: 'number' | 'letter';
    numValue: number;
    strValue: string;
}

/**
 * Parse a position string like "1.2.a" into comparable segments.
 */
function parsePosition(posStr: string): PositionSegment[] {
    // Split by dots, filtering empty segments
    const parts = posStr.split('.').map(p => p.trim()).filter(Boolean);

    return parts.map(part => {
        const num = parseInt(part, 10);
        if (!isNaN(num) && String(num) === part.trim()) {
            return { type: 'number' as const, numValue: num, strValue: part };
        }
        return { type: 'letter' as const, numValue: 0, strValue: part.toLowerCase() };
    });
}

/**
 * Extract the position prefix from a product name.
 * Returns null if no position is found.
 */
function extractPosition(name: string): PositionSegment[] | null {
    const trimmed = name.trim();
    const match = trimmed.match(POSITION_REGEX);
    if (!match) return null;
    return parsePosition(match[1]);
}

/**
 * Compare two segment arrays hierarchically.
 */
function comparePositions(a: PositionSegment[], b: PositionSegment[]): number {
    const maxLen = Math.max(a.length, b.length);

    for (let i = 0; i < maxLen; i++) {
        const segA = a[i];
        const segB = b[i];

        // Shorter position comes first (poz 1 before poz 1.1)
        if (!segA && segB) return -1;
        if (segA && !segB) return 1;
        if (!segA || !segB) return 0;

        // Both are numbers — compare numerically
        if (segA.type === 'number' && segB.type === 'number') {
            if (segA.numValue !== segB.numValue) {
                return segA.numValue - segB.numValue;
            }
            continue;
        }

        // Numbers come before letters (1.1 before 1.a)
        if (segA.type === 'number' && segB.type === 'letter') return -1;
        if (segA.type === 'letter' && segB.type === 'number') return 1;

        // Both are letters — compare alphabetically
        const strCmp = segA.strValue.localeCompare(segB.strValue, 'hr');
        if (strCmp !== 0) return strCmp;
    }

    return 0;
}

/**
 * Sort an array of items by their product name using hierarchical position sorting.
 * 
 * @param items - Array of items to sort
 * @param getName - Function to extract the product name from an item
 * @returns A new sorted array (does not modify the original)
 */
export function sortProductsByName<T>(items: T[], getName: (item: T) => string): T[] {
    return [...items].sort((a, b) => {
        const nameA = getName(a);
        const nameB = getName(b);

        const posA = extractPosition(nameA);
        const posB = extractPosition(nameB);

        // Both have positions — compare hierarchically
        if (posA && posB) {
            const cmp = comparePositions(posA, posB);
            if (cmp !== 0) return cmp;
            // Same position — compare full names alphabetically
            return nameA.localeCompare(nameB, 'hr');
        }

        // Only one has a position — positioned items come first
        if (posA && !posB) return -1;
        if (!posA && posB) return 1;

        // Neither has a position — sort alphabetically
        return nameA.localeCompare(nameB, 'hr');
    });
}
