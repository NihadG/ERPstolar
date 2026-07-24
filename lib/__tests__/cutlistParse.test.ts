// Testovi parsera krojne liste i fuzzy sparivanja materijala.

import { parseCutlistText, parseEuroNumber, normalizeMaterialKey, groupKeysInOrder } from '../cutlist/parse';
import { suggestMaterials, matchMaterialLabels } from '../cutlist/match';
import type { Material } from '../types';

describe('parseEuroNumber', () => {
    it('čita evropske i američke formate', () => {
        expect(parseEuroNumber('1.200,50')).toBe(1200.5);
        expect(parseEuroNumber('1,200.50')).toBe(1200.5);
        expect(parseEuroNumber('3,5')).toBe(3.5);
        expect(parseEuroNumber('1,200')).toBe(1200);
        expect(parseEuroNumber('528')).toBe(528);
        expect(parseEuroNumber('')).toBeNaN();
        expect(parseEuroNumber('abc')).toBeNaN();
    });
});

describe('normalizeMaterialKey', () => {
    it('skida dijakritike, nevidljive znakove i interpunkciju', () => {
        expect(normalizeMaterialKey('Iveral bijeli')).toBe('iveral bijeli');
        expect(normalizeMaterialKey('IVERAL  Bijeli!')).toBe('iveral bijeli');
        expect(normalizeMaterialKey('Ploča​čamova đtruplo')).toBe('plocacamova dtruplo');
        expect(normalizeMaterialKey('Šišarka Žuta Ćup')).toBe('sisarka zuta cup');
    });

    it('isti naziv sa zero-width znakom daje isti ključ', () => {
        expect(normalizeMaterialKey('Medijapan')).toBe(normalizeMaterialKey('Medij​apan'));
    });
});

describe('parseCutlistText', () => {
    it('parsira CSV sa zaglavljem i materijalima', () => {
        const csv = `Naziv,Sirina,Visina,Kolicina,Materijal
Fronta,1200,600,2,Iveral bijeli
Bok,720,560,4,Iveral bijeli
Ledja,1180,700,1,Lesonit crni`;
        const res = parseCutlistText(csv);
        expect(res.parts).toHaveLength(3);
        expect(res.parts[0]).toMatchObject({ name: 'Fronta', width: 1200, height: 600, qty: 2, materialRaw: 'Iveral bijeli' });
        expect(res.parts[2].materialKey).toBe('lesonit crni');
        expect(res.skipped).toBe(0);
    });

    it('parsira TSV (Excel paste) s kolonama dužina/širina i debljinom', () => {
        const tsv = 'Element\tDužina\tŠirina\tKom\tMaterijal\tDebljina\nVrata\t715\t396\t2\tMedijapan\t18\nPolica\t764\t500\t3\tMedijapan\t18';
        const res = parseCutlistText(tsv);
        expect(res.parts).toHaveLength(2);
        expect(res.parts[0]).toMatchObject({ width: 715, height: 396, qty: 2 });
        // Debljina se lijepi u naziv materijala.
        expect(res.parts[0].materialRaw).toBe('Medijapan 18mm');
        expect(res.parts[0].materialKey).toBe('medijapan 18mm');
    });

    it('pozicioni format bez zaglavlja (Š,V,Kol)', () => {
        const res = parseCutlistText('600,400,3\n800,500,1');
        expect(res.parts).toHaveLength(2);
        expect(res.parts[0]).toMatchObject({ width: 600, height: 400, qty: 3 });
        expect(res.parts[0].name).toBe('Dio 1');
    });

    it('spaja identične redove u jedan komad sa zbirom količina', () => {
        const csv = `Naziv,Sirina,Visina,Kolicina,Materijal
Bok,720,560,2,Iveral
Bok,720,560,3,Iveral`;
        const res = parseCutlistText(csv);
        expect(res.parts).toHaveLength(1);
        expect(res.parts[0].qty).toBe(5);
    });

    it('čita kant kolone', () => {
        const csv = `Naziv,Dužina,Širina,Kol,Materijal,Kant D,Kant Š
Fronta,600,400,1,Iveral,2,2
Polica,500,300,1,Iveral,1,0`;
        const res = parseCutlistText(csv);
        expect(res.parts[0]).toMatchObject({ edgeL: 2, edgeW: 2 });
        expect(res.parts[1].edgeL).toBe(1);
        expect(res.parts[1].edgeW).toBeUndefined();
    });

    it('prepoznaje K-D / K-Š skraćene kant kolone', () => {
        const csv = `Naziv,Dužina,Širina,Kol,Materijal,K-D,K-Š
Fronta,600,400,1,Iveral,1,2`;
        const res = parseCutlistText(csv);
        expect(res.parts[0]).toMatchObject({ edgeL: 1, edgeW: 2 });
    });

    it('bez kant kolona podrazumijeva kant 2/2 na svim komadima', () => {
        const csv = `Naziv,Sirina,Visina,Kolicina,Materijal
Fronta,600,400,2,Iveral
Bok,720,560,4,Iveral`;
        const res = parseCutlistText(csv);
        for (const p of res.parts) {
            expect(p.edgeL).toBe(2);
            expect(p.edgeW).toBe(2);
        }
        // I pozicioni format bez zaglavlja dobija default 2/2.
        const pos = parseCutlistText('600,400,3');
        expect(pos.parts[0]).toMatchObject({ edgeL: 2, edgeW: 2 });
    });

    it('CSV s tačkom-zarez separatorom i decimalnim zarezom', () => {
        const csv = 'Naziv;Sirina;Visina;Kolicina\nDio;600,5;400;2';
        const res = parseCutlistText(csv);
        expect(res.parts).toHaveLength(1);
        expect(res.parts[0].width).toBe(600.5);
    });

    it('broji preskočene redove', () => {
        const res = parseCutlistText('600,400,2\nxx,yy,zz');
        expect(res.parts).toHaveLength(1);
        expect(res.skipped).toBe(1);
    });

    it('groupKeysInOrder izvodi grupe u redoslijedu pojavljivanja', () => {
        const csv = `Naziv,Sirina,Visina,Kolicina,Materijal
A,600,400,2,Medijapan
B,700,500,1,Iveral bijeli
C,800,600,3,Medijapan`;
        const res = parseCutlistText(csv);
        const groups = groupKeysInOrder(res.parts);
        expect(groups.map(g => g.label)).toEqual(['Medijapan', 'Iveral bijeli']);
        expect(groups[0].count).toBe(5);
    });
});

function mat(id: string, name: string, category = 'Ploče i trake'): Material {
    return {
        Material_ID: id, Organization_ID: 'org', Name: name, Category: category,
        Unit: 'm²', Default_Supplier: '', Default_Unit_Price: 0, Description: '',
    };
}

describe('suggestMaterials / matchMaterialLabels', () => {
    const catalog: Material[] = [
        mat('m1', 'Iveral bijeli 18mm'),
        mat('m2', 'Iveral hrast sonoma 18mm'),
        mat('m3', 'Medijapan 18mm'),
        mat('m4', 'Lesonit crni 3mm'),
        mat('m5', 'Kant traka ABS bijela 22mm'),
        mat('m6', 'Staklo float 6mm', 'Staklo'),
        mat('m7', 'Vijak 4x30', 'Okovi'),
    ];

    it('nalazi tačan materijal uprkos razlikama u pisanju', () => {
        const s = suggestMaterials('IVERAL BIJELI', catalog);
        expect(s[0].material.Material_ID).toBe('m1');
    });

    it('razlikuje dekore istog tipa ploče', () => {
        const s = suggestMaterials('iveral hrast sonoma', catalog);
        expect(s[0].material.Material_ID).toBe('m2');
    });

    it('preskače staklo (ima svoj tok)', () => {
        const s = suggestMaterials('staklo float', catalog);
        expect(s.find(x => x.material.Material_ID === 'm6')).toBeUndefined();
    });

    it('auto-match samo kad je pouzdan', () => {
        const matches = matchMaterialLabels(['Medijapan 18mm', 'Egzotični dekor XYZ'], catalog);
        expect(matches[0].autoMatch?.Material_ID).toBe('m3');
        expect(matches[1].autoMatch).toBeNull();
    });
});
