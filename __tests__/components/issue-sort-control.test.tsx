// @vitest-environment jsdom
// The series page's sort control (#203 round 3): offers exactly the four shared modes, shows the
// current one, and reports a change as a typed mode — never a raw string.
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { IssueSortControl } from '@/components/issue-sort-control';
import { ISSUE_SORT_MODES } from '@/lib/utils/issue-sort';

// Radix Select needs pointer and layout APIs jsdom lacks; a native <select> shim keeps the test
// about THIS component's wiring — options, value, change — not Radix's popover mechanics.
vi.mock('@/components/ui/select', () => ({
    Select: ({ value, onValueChange, children }: any) => {
        const items: any[] = [];
        const walk = (node: any) => React.Children.forEach(node, (c: any) => {
            if (!c) return;
            if (c.type?.displayName === 'SelectItem') items.push(c);
            else if (c.props?.children) walk(c.props.children);
        });
        walk(children);
        const trigger = React.Children.toArray(children).find((c: any) => c.type?.displayName === 'SelectTrigger') as any;
        return (
            <select aria-label={trigger?.props?.['aria-label']} value={value} onChange={(e) => onValueChange(e.target.value)}>
                {items.map((c: any) => <option key={c.props.value} value={c.props.value}>{c.props.children}</option>)}
            </select>
        );
    },
    SelectTrigger: Object.assign(({ children }: any) => <>{children}</>, { displayName: 'SelectTrigger' }),
    SelectValue: () => null,
    SelectContent: ({ children }: any) => <>{children}</>,
    SelectItem: Object.assign(({ children }: any) => <>{children}</>, { displayName: 'SelectItem' }),
}));

describe('IssueSortControl', () => {
    it('offers the four shared modes and shows the current one', () => {
        render(<IssueSortControl value="date_desc" onChange={() => {}} />);
        const select = screen.getByLabelText('Sort issues') as HTMLSelectElement;
        expect(select.value).toBe('date_desc');
        expect(Array.from(select.options).map(o => o.value)).toEqual(ISSUE_SORT_MODES.map(m => m.value));
        expect(Array.from(select.options).map(o => o.textContent)).toEqual(ISSUE_SORT_MODES.map(m => m.label));
    });

    it('reports a change as a sort mode', () => {
        const onChange = vi.fn();
        render(<IssueSortControl value="number_asc" onChange={onChange} />);
        fireEvent.change(screen.getByLabelText('Sort issues'), { target: { value: 'date_asc' } });
        expect(onChange).toHaveBeenCalledWith('date_asc');
    });
});
