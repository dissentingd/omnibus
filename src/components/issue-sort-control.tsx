"use client"

// The series page's issue-list sort (#203 round 3): by number in either direction, or by release
// date so annuals fall into place between the issues. One choice, remembered for every series page.
import { ArrowUpDown } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ISSUE_SORT_MODES, parseIssueSortMode, type IssueSortMode } from "@/lib/utils/issue-sort"

export function IssueSortControl({ value, onChange, className }: { value: IssueSortMode; onChange: (mode: IssueSortMode) => void; className?: string }) {
    return (
        <Select value={value} onValueChange={(v) => { const mode = parseIssueSortMode(v); if (mode) onChange(mode); }}>
            <SelectTrigger aria-label="Sort issues" className={className || "h-8 w-auto gap-1 px-2 text-xs font-bold bg-background shadow-sm border-border"}>
                <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="hidden sm:inline"><SelectValue /></span>
            </SelectTrigger>
            <SelectContent align="end">
                {ISSUE_SORT_MODES.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
