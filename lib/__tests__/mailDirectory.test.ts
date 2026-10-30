import { searchPeople, tallyPeople, type MailPerson } from '@/lib/email/directory';

// Imena i domeni su izmišljeni.
describe('imenik pošte', () => {
    const own = ['ja@luxco-demo.example'];

    it('poslani: Kome i Kopija, najčešće ime, broj i zadnji datum; bez tebe i no-reply', () => {
        const people = tallyPeople([
            { sent: true, date: '2026-09-01T08:00:00Z', to: 'Mia Ploče <mia@ploce-demo.example>', cc: 'ja@luxco-demo.example, noreply@servis-demo.example' },
            { sent: true, date: '2026-09-10T08:00:00Z', to: '"Mia Ploče" <MIA@ploce-demo.example>, lejla@studio-demo.example' },
            { sent: true, date: '2026-09-12T08:00:00Z', to: 'Mia <mia@ploce-demo.example>' },
        ], { own });
        expect(people).toEqual([
            { Email: 'mia@ploce-demo.example', Name: 'Mia Ploče', Count: 3, Last_At: '2026-09-12T08:00:00Z' },
            { Email: 'lejla@studio-demo.example', Count: 1, Last_At: '2026-09-10T08:00:00Z' },
        ]);
    });

    it('primljeni: osvježi poznate; nepoznate dodaje samo kad su dozvoljeni (prepoznati)', () => {
        const prev: MailPerson[] = [{ Email: 'lejla@studio-demo.example', Count: 1, Last_At: '2026-09-10T08:00:00Z' }];
        const people = tallyPeople([
            { sent: false, date: '2026-10-01T08:00:00Z', from: 'Lejla Demo <lejla@studio-demo.example>' },
            { sent: false, date: '2026-10-02T08:00:00Z', from: 'Akcija <promo@trgovina-demo.example>' },
            { sent: false, date: '2026-10-03T08:00:00Z', from: 'Mia <mia@ploce-demo.example>' },
        ], { own, prev, allowSender: e => e.endsWith('@ploce-demo.example') });
        expect(people.map(p => `${p.Name}|${p.Email}|${p.Count}`)).toEqual([
            'Lejla Demo|lejla@studio-demo.example|2',
            'Mia|mia@ploce-demo.example|1',
        ]);
    });

    it('traženje po imenu u padežu, prezimenu i adresi', () => {
        const people: MailPerson[] = [
            { Email: 'amra.demic@ploce-demo.example', Name: 'Amra Demić', Count: 3, Last_At: '' },
            { Email: 'lejla@studio-demo.example', Name: 'Lejla Demo', Count: 1, Last_At: '' },
        ];
        expect(searchPeople(people, 'Amri').map(p => p.Email)).toEqual(['amra.demic@ploce-demo.example']);
        expect(searchPeople(people, 'Demić').map(p => p.Email)).toEqual(['amra.demic@ploce-demo.example']);
        expect(searchPeople(people, 'Lejli').map(p => p.Email)).toEqual(['lejla@studio-demo.example']);
        expect(searchPeople(people, 'Zoran')).toEqual([]);
    });
});
