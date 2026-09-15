// src/components/coverage-field.tsx
//
// #203 COLLECTED coverage (field report by robotshavehearts2): the collected panel's Covers field.
// A book's `coversIssues` — "1-6, 8" — is curation, so it saves through the issue PATCH, which
// validates and canonicalises; the field then shows the SERVER's answer, not what was typed. A
// refusal keeps the field open and says why. Every click stops at the field: the card behind it
// opens the book's panel, and editing a range must not.
"use client"

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Loader2, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

interface CoverageFieldProps {
    issueId: string;
    /** The book as the user knows it ("Vol. 1: The Zoo") — for the accessible names. */
    bookLabel: string;
    value: string | null;
    canEdit: boolean;
    /** Called with the canonical value the server stored (null when cleared). */
    onSaved: (next: string | null) => void;
    className?: string;
}

export function CoverageField({ issueId, bookLabel, value, canEdit, onSaved, className }: CoverageFieldProps) {
    const { toast } = useToast();
    const [editing, setEditing] = useState(false);
    // What the field shows: the prop until a save, then the server's canonical answer at once —
    // the parent is told too, but the field must not wait on it to tell the truth.
    const [shown, setShown] = useState<string | null>(value);
    const [draft, setDraft] = useState(value ?? "");
    const [saving, setSaving] = useState(false);
    // Escape closes the field; the blur that may follow must not turn into a save. And a draft the
    // server already refused is abandoned on blur rather than re-sent (and re-refused) forever.
    const cancelledRef = useRef(false);
    const refusedRef = useRef<string | null>(null);

    useEffect(() => { setShown(value); }, [value]);
    useEffect(() => { if (!editing) setDraft(shown ?? ""); }, [shown, editing]);

    const stop = (e: MouseEvent) => e.stopPropagation();

    const close = () => {
        setEditing(false);
        setDraft(shown ?? "");
        refusedRef.current = null;
    };

    const save = async () => {
        if (saving) return;
        const next = draft;
        if (next.trim() === (shown ?? "")) { close(); return; }
        setSaving(true);
        try {
            const res = await fetch('/api/library/issue', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ issueId, coversIssues: next }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                refusedRef.current = next;
                toast({ title: "Coverage not saved", description: data.error || `HTTP ${res.status}`, variant: "destructive" });
                return;
            }
            const canon: string | null = data.coversIssues ?? null;
            refusedRef.current = null;
            setShown(canon);
            setDraft(canon ?? "");
            setEditing(false);
            onSaved(canon);
        } catch {
            refusedRef.current = next;
            toast({ title: "Coverage not saved", description: "Couldn't reach the server.", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') { e.preventDefault(); void save(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelledRef.current = true; close(); }
    };

    const onBlur = () => {
        if (cancelledRef.current) { cancelledRef.current = false; return; }
        if (refusedRef.current !== null && refusedRef.current === draft) { close(); return; }
        void save();
    };

    if (!editing) {
        if (!canEdit) {
            return shown ? <span className={cn("text-[11px] text-muted-foreground", className)}>Covers #{shown}</span> : null;
        }
        return (
            <button
                type="button"
                onClick={(e) => { stop(e); setEditing(true); }}
                aria-label={`Edit the issues ${bookLabel} covers`}
                title="Which issues of the run this book reprints — e.g. 1-6, 8"
                className={cn(
                    "inline-flex items-center gap-1 text-[11px] rounded px-1 -mx-1 transition-colors hover:bg-muted",
                    shown ? "text-muted-foreground hover:text-foreground" : "text-primary/80 hover:text-primary",
                    className
                )}
            >
                <Pencil className="w-3 h-3 shrink-0" />
                {shown ? `Covers #${shown}` : 'Set coverage'}
            </button>
        );
    }

    return (
        <span onClick={stop} className={cn("inline-flex items-center gap-1", className)}>
            <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                onBlur={onBlur}
                onClick={stop}
                aria-label={`Issues ${bookLabel} covers`}
                placeholder="e.g. 1-6, 8"
                disabled={saving}
                className="h-7 w-36 text-xs px-2 bg-background border-border"
            />
            {saving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
        </span>
    );
}
