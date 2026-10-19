import type { Project, Task } from '@/lib/types';
import { MOBILE_SCREEN_ORDER, MOBILE_TABS, mobileTabOf } from '../MobileTabBar';
import {
    countFilters, daysToDue, dueLabel, groupTasks, matchesFilter, sortTasks, taskProjectId,
} from '../taskListModel';

const TODAY = '2026-10-19'; // ponedjeljak

const task = (id: string, extra: Partial<Task> = {}): Task => ({
    Task_ID: id, Organization_ID: 'o', Title: id, Description: '', Status: 'pending',
    Priority: 'medium', Category: 'general', Created_Date: '2026-10-01', Links: [], ...extra,
});

describe('mobilna traka', () => {
    it('ima pet dugmadi i Zadaci su na traci', () => {
        expect(MOBILE_TABS.map(t => t.id)).toEqual(['projects', 'sales', 'make', 'tasks', 'account']);
    });

    it('grupe imaju podtabove u traženom redoslijedu (prvi je podrazumijevani)', () => {
        expect(mobileTabOf('offers')?.subTabs?.map(s => s.id)).toEqual(['orders', 'offers']);
        expect(mobileTabOf('attendance')?.subTabs?.map(s => s.id)).toEqual(['production', 'attendance']);
        expect(mobileTabOf('platno')).toBeNull();
    });

    it('prevlačenje prolazi kroz podtabove redom', () => {
        expect(MOBILE_SCREEN_ORDER).toEqual(['projects', 'orders', 'offers', 'production', 'attendance', 'tasks', 'account']);
    });
});

describe('rokovi', () => {
    it('računa dane i natpise', () => {
        expect(daysToDue(task('a', { Due_Date: '2026-10-17' }), TODAY)).toBe(-2);
        expect(dueLabel(task('a', { Due_Date: '2026-10-17' }), TODAY)).toEqual({ text: 'kasni 2 dana', tone: 'late' });
        expect(dueLabel(task('a', { Due_Date: '2026-10-19T00:00:00Z' }), TODAY)).toEqual({ text: 'danas', tone: 'soon' });
        expect(dueLabel(task('a', { Due_Date: '2026-10-20' }), TODAY)?.text).toBe('sutra');
        expect(dueLabel(task('a', { Due_Date: '2026-10-23' }), TODAY)?.text).toBe('pet 23.10.');
        expect(dueLabel(task('a', { Due_Date: '2026-11-05' }), TODAY)?.text).toBe('5.11.');
        expect(dueLabel(task('a'), TODAY)).toBeNull();
    });

    it('završen zadatak ne kasni', () => {
        const done = task('a', { Due_Date: '2026-10-10', Status: 'completed' });
        expect(dueLabel(done, TODAY)?.tone).toBe('');
        expect(matchesFilter(done, 'late', TODAY)).toBe(false);
    });
});

describe('filteri, sortiranje, grupe', () => {
    const list = [
        task('later', { Due_Date: '2026-11-20' }),
        task('late', { Due_Date: '2026-10-15', Priority: 'low' }),
        task('done', { Status: 'completed', Due_Date: '2026-10-01' }),
        task('today-urgent', { Due_Date: '2026-10-19', Priority: 'urgent', Status: 'in_progress' }),
        task('nodate'),
    ];

    it('broji filtere', () => {
        expect(countFilters(list, TODAY)).toEqual({ open: 4, late: 1, in_progress: 1, done: 1, all: 5 });
    });

    it('sortira: otvoreni po roku, bez roka na kraju, završeni na dnu', () => {
        expect(sortTasks(list, TODAY).map(t => t.Task_ID)).toEqual(['late', 'today-urgent', 'later', 'nodate', 'done']);
    });

    it('grupiše po roku sa Završeno na dnu', () => {
        const g = groupTasks(sortTasks(list, TODAY), 'due', TODAY);
        expect(g.map(x => x.label)).toEqual(['Kasni', 'Danas', 'Kasnije', 'Bez roka', 'Završeno']);
        expect(g[0].tone).toBe('late');
    });

    it('projekat zadatka nalazi i preko proizvoda', () => {
        const projects = [{ Project_ID: 'p1', Client_Name: 'K', products: [{ Product_ID: 'pr1' }] }] as unknown as Project[];
        expect(taskProjectId(task('x', { Links: [{ Entity_Type: 'product', Entity_ID: 'pr1', Entity_Name: 'P' }] }), projects)).toBe('p1');
        expect(taskProjectId(task('y'), projects)).toBeNull();
        const byProject = groupTasks([task('x', { Links: [{ Entity_Type: 'product', Entity_ID: 'pr1', Entity_Name: 'P' }] }), task('y')], 'project', TODAY, projects);
        expect(byProject.map(x => x.label)).toEqual(['K', 'Bez projekta']);
    });
});
