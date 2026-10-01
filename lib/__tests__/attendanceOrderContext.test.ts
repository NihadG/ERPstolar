import { getAttendanceOrderContext } from '../attendance';
import { getDocs } from 'firebase/firestore';

jest.mock('../firebase', () => ({ db: {} }));
jest.mock('../database', () => ({}));
jest.mock('firebase/firestore', () => ({
    collection: jest.fn(() => ({})),
    query: jest.fn(() => ({})),
    where: jest.fn(() => ({})),
    orderBy: jest.fn(() => ({})),
    limitToLast: jest.fn(() => ({})),
    getDocs: jest.fn(),
}));

const mockGetDocs = getDocs as jest.Mock;

describe('getAttendanceOrderContext', () => {
    beforeEach(() => {
        mockGetDocs.mockReset();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    test('opens with current bookings even if one worker history lookup fails', async () => {
        mockGetDocs
            .mockResolvedValueOnce({
                docs: [{ data: () => ({ Worker_ID: 'w1', Work_Order_ID: 'order-today', Presence: 1 }) }],
            })
            .mockRejectedValueOnce(new Error('missing history index'))
            .mockResolvedValueOnce({ empty: true, docs: [] });

        const context = await getAttendanceOrderContext('2026-09-30', 'org', ['w1', 'w2']);

        expect(context.postedTodayByWorker.get('w1')).toEqual(['order-today']);
        expect(context.postedPresenceByWorker.get('w1')).toBe(1);
        expect(context.historyLookupFailed).toBe(true);
        expect(context.previousByWorker.size).toBe(0);
    });
});
