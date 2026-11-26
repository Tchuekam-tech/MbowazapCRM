'use client';

import { useState, useRef } from 'react';
import { toast } from 'sonner';
import {
  BookOpen,
  Building2,
  FileText,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type {
  JarvisBrandVoice,
  JarvisCompanyProfile,
  JarvisFaqPair,
  JarvisOverviewPayload,
  KnowledgeSourceType,
} from '@/types/jarvis';

interface JarvisKnowledgeHubTabProps {
  data: JarvisOverviewPayload;
  canEdit: boolean;
  onRefresh: () => Promise<void>;
}

const SOURCE_BADGES: Record<KnowledgeSourceType, string> = {
  company_bio: 'bg-purple-500/15 text-purple-300',
  website: 'bg-sky-500/15 text-sky-300',
  document: 'bg-emerald-500/15 text-emerald-300',
  product_catalog: 'bg-amber-500/15 text-amber-300',
  policy: 'bg-rose-500/15 text-rose-300',
  faq: 'bg-indigo-500/15 text-indigo-300',
  manual: 'bg-muted text-muted-foreground',
};

export function JarvisKnowledgeHubTab({
  data,
  canEdit,
  onRefresh,
}: JarvisKnowledgeHubTabProps) {
  const [profile, setProfile] = useState<JarvisCompanyProfile>(data.profile);
  const [savingProfile, setSavingProfile] = useState(false);

  // Website connector state
  const [siteUrl, setSiteUrl] = useState('');
  const [siteTitle, setSiteTitle] = useState('');
  const [crawlSubpages, setCrawlSubpages] = useState(true);
  const [autoSyncHours, setAutoSyncHours] = useState<string>('24');
  const [crawling, setCrawling] = useState(false);
  const [syncingUrlId, setSyncingUrlId] = useState<string | null>(null);

  // Document upload state
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadCategory, setUploadCategory] = useState<KnowledgeSourceType>('document');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Quick manual knowledge entry
  const [manualTitle, setManualTitle] = useState('');
  const [manualContent, setManualContent] = useState('');
  const [savingManual, setSavingManual] = useState(false);

  const updateField = <K extends keyof JarvisCompanyProfile>(
    key: K,
    value: JarvisCompanyProfile[K]
  ) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  };

  const addFaq = () => {
    updateField('faq_pairs', [...(profile.faq_pairs ?? []), { question: '', answer: '' }]);
  };

  const updateFaq = (idx: number, field: keyof JarvisFaqPair, val: string) => {
    const next = [...(profile.faq_pairs ?? [])];
    next[idx] = { ...next[idx], [field]: val };
    updateField('faq_pairs', next);
  };

  const removeFaq = (idx: number) => {
    updateField(
      'faq_pairs',
      (profile.faq_pairs ?? []).filter((_, i) => i !== idx)
    );
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      const res = await fetch('/api/jarvis/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Failed to save Company DNA');
        return;
      }
      if (json.profile) setProfile(json.profile);
      if (json.warning) toast.warning(json.warning);
      else toast.success('Company Bio & Brand DNA saved and indexed for Jarvis!');
      await onRefresh();
    } catch {
      toast.error('Network error saving profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleCrawlWebsite = async () => {
    if (!siteUrl.trim()) {
      toast.error('Enter a website URL first');
      return;
    }
    setCrawling(true);
    try {
      const res = await fetch('/api/jarvis/knowledge/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: siteUrl.trim(),
          title: siteTitle.trim() || undefined,
          crawlSubpages,
          autoSyncHours: autoSyncHours ? Number(autoSyncHours) : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Failed to crawl website');
        return;
      }
      if (json.warning) toast.warning(json.warning);
      else {
        toast.success(
          `Connected "${json.title}" (${json.pagesCrawled} page(s), ${json.chunkCount} chunks indexed)`
        );
      }
      setSiteUrl('');
      setSiteTitle('');
      await onRefresh();
    } catch {
      toast.error('Network error crawling website');
    } finally {
      setCrawling(false);
    }
  };

  const handleUploadFile = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast.error('Select a business document (.txt, .md, .csv, .json, .html, .pdf)');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('sourceType', uploadCategory);
      if (uploadTitle.trim()) form.append('title', uploadTitle.trim());

      const res = await fetch('/api/jarvis/knowledge/upload', {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Upload failed');
        return;
      }
      if (json.warning) toast.warning(json.warning);
      else toast.success(`Indexed "${json.title}" (${json.chunkCount} chunks)`);
      setUploadTitle('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await onRefresh();
    } catch {
      toast.error('Network error uploading document');
    } finally {
      setUploading(false);
    }
  };

  const handleSaveManual = async () => {
    if (!manualTitle.trim() || !manualContent.trim()) {
      toast.error('Title and content are required');
      return;
    }
    setSavingManual(true);
    try {
      const res = await fetch('/api/ai/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: manualTitle.trim(),
          content: manualContent.trim(),
          source_type: 'manual',
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Failed to save knowledge entry');
        return;
      }
      toast.success('Knowledge entry saved & indexed');
      setManualTitle('');
      setManualContent('');
      await onRefresh();
    } catch {
      toast.error('Network error saving note');
    } finally {
      setSavingManual(false);
    }
  };

  const handleResyncWebsite = async (documentId?: string) => {
    setSyncingUrlId(documentId ?? 'all');
    try {
      const res = await fetch('/api/jarvis/knowledge/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(documentId ? { documentId } : {}),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Sync failed');
        return;
      }
      toast.success(`Synced ${json.synced} website source(s)`);
      await onRefresh();
    } catch {
      toast.error('Network error syncing websites');
    } finally {
      setSyncingUrlId(null);
    }
  };

  const handleDeleteDoc = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Knowledge source removed');
        await onRefresh();
      } else {
        toast.error('Failed to delete source');
      }
    } catch {
      toast.error('Network error deleting source');
    }
  };

  return (
    <div className="space-y-5">
      {/* 1. Company Bio & Brand DNA */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-primary" />
              Company Bio & Brand DNA (Plug-and-Play Onboarding)
            </CardTitle>
            <CardDescription>
              Fill this out once — Jarvis and WhatsApp auto-replies instantly learn your identity, voice, products, pricing, hours, policies, and FAQs.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-xs font-semibold text-primary">
                {profile.completeness_score}% Complete
              </span>
              <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${profile.completeness_score}%` }}
                />
              </div>
            </div>
            {canEdit && (
              <Button onClick={handleSaveProfile} disabled={savingProfile} size="sm">
                {savingProfile ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-4 w-4" />
                )}
                Save & Index DNA
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Company Name</Label>
              <Input
                value={profile.company_name}
                onChange={(e) => updateField('company_name', e.target.value)}
                placeholder="Acme Wellness Co."
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1">
              <Label>Tagline</Label>
              <Input
                value={profile.tagline}
                onChange={(e) => updateField('tagline', e.target.value)}
                placeholder="Same-day care delivered via WhatsApp"
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1">
              <Label>Industry</Label>
              <Input
                value={profile.industry}
                onChange={(e) => updateField('industry', e.target.value)}
                placeholder="E-commerce, Real Estate, SaaS, Agency…"
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1">
              <Label>Official Website</Label>
              <Input
                value={profile.website_url}
                onChange={(e) => updateField('website_url', e.target.value)}
                placeholder="https://yourcompany.com"
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1">
              <Label>Business Hours & Timezone</Label>
              <Input
                value={profile.business_hours}
                onChange={(e) => updateField('business_hours', e.target.value)}
                placeholder="Mon-Sat 8:00 AM - 7:00 PM"
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1">
              <Label>Brand Voice</Label>
              <select
                value={profile.brand_voice}
                onChange={(e) => updateField('brand_voice', e.target.value as JarvisBrandVoice)}
                disabled={!canEdit}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="consultative">Consultative & Helpful</option>
                <option value="friendly">Warm & Friendly</option>
                <option value="professional">Formal & Professional</option>
                <option value="bold">High-Energy & Direct</option>
                <option value="luxury">Luxury & Concierge</option>
                <option value="custom">Custom Instructions</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Company Bio & Story</Label>
              <Textarea
                rows={3}
                value={profile.company_bio}
                onChange={(e) => updateField('company_bio', e.target.value)}
                placeholder="Who you are, what makes your business unique, who you serve, and your mission…"
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1">
              <Label>Products & Services Catalog Summary</Label>
              <Textarea
                rows={3}
                value={profile.products_services_summary}
                onChange={(e) => updateField('products_services_summary', e.target.value)}
                placeholder="List your flagship products, packages, deliverables, or service tiers…"
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1">
              <Label>Pricing, Discounts & Payment Methods</Label>
              <Textarea
                rows={3}
                value={profile.pricing_summary}
                onChange={(e) => updateField('pricing_summary', e.target.value)}
                placeholder="Starter $49/mo, Pro $149/mo. Mobile Money, Visa/Mastercard, bank transfer…"
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1">
              <Label>Policies & Escalation Rules</Label>
              <Textarea
                rows={3}
                value={profile.policies_summary}
                onChange={(e) => updateField('policies_summary', e.target.value)}
                placeholder="Delivery times, refund policy, warranties, and when Jarvis must hand off to a human…"
                disabled={!canEdit}
              />
            </div>
          </div>

          {/* Dynamic FAQ Pairs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Built-in FAQs ({(profile.faq_pairs ?? []).length})</Label>
              {canEdit && (
                <Button variant="outline" size="sm" onClick={addFaq}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add FAQ
                </Button>
              )}
            </div>
            {(profile.faq_pairs ?? []).map((faq, idx) => (
              <div
                key={idx}
                className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-muted/20 p-2.5 md:grid-cols-12"
              >
                <Input
                  className="md:col-span-5"
                  placeholder="Customer question…"
                  value={faq.question}
                  onChange={(e) => updateFaq(idx, 'question', e.target.value)}
                  disabled={!canEdit}
                />
                <Input
                  className="md:col-span-6"
                  placeholder="Official answer…"
                  value={faq.answer}
                  onChange={(e) => updateFaq(idx, 'answer', e.target.value)}
                  disabled={!canEdit}
                />
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive md:col-span-1"
                    onClick={() => removeFaq(idx)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 2. Connect Website Links + Upload Business Docs side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-4 w-4 text-sky-400" />
              Connect Website Links & Help Centers
            </CardTitle>
            <CardDescription>
              Paste any public URL (website, pricing page, FAQ, Notion/Docs link). Jarvis crawls clean text & auto-refreshes on schedule.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Website URL</Label>
              <Input
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                placeholder="https://yourcompany.com"
                disabled={!canEdit || crawling}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Label (optional)</Label>
                <Input
                  value={siteTitle}
                  onChange={(e) => setSiteTitle(e.target.value)}
                  placeholder="Main Website"
                  disabled={!canEdit || crawling}
                />
              </div>
              <div className="space-y-1">
                <Label>Auto-Sync Schedule</Label>
                <select
                  value={autoSyncHours}
                  onChange={(e) => setAutoSyncHours(e.target.value)}
                  disabled={!canEdit || crawling}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  <option value="24">Auto-refresh every 24h</option>
                  <option value="168">Auto-refresh weekly</option>
                  <option value="">Manual sync only</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={crawlSubpages}
                onChange={(e) => setCrawlSubpages(e.target.checked)}
                disabled={!canEdit || crawling}
              />
              Also crawl up to 4 key internal pages (/about, /pricing, /faq, /services)
            </label>
            <Button
              onClick={handleCrawlWebsite}
              disabled={!canEdit || crawling || !siteUrl.trim()}
              className="w-full"
            >
              {crawling ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Globe className="mr-2 h-4 w-4" />
              )}
              Crawl & Connect Website
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4 text-emerald-400" />
              Upload Business Docs & Catalogs
            </CardTitle>
            <CardDescription>
              Upload brochures, price sheets, SOPs, or product catalogs (`.pdf`, `.txt`, `.md`, `.csv`, `.json`, `.html` up to 5 MB).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Choose Document</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.markdown,.csv,.json,.html,.htm,.pdf"
                disabled={!canEdit || uploading}
                className="flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs file:mr-3 file:rounded file:border-0 file:bg-primary/15 file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-primary"
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Document Title (optional)</Label>
                <Input
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="2026 Price List"
                  disabled={!canEdit || uploading}
                />
              </div>
              <div className="space-y-1">
                <Label>Category</Label>
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value as KnowledgeSourceType)}
                  disabled={!canEdit || uploading}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  <option value="document">Business Document</option>
                  <option value="product_catalog">Product Catalog / Pricing</option>
                  <option value="policy">Policy / SOP</option>
                  <option value="faq">FAQ Sheet</option>
                </select>
              </div>
            </div>
            <Button
              onClick={handleUploadFile}
              disabled={!canEdit || uploading}
              className="w-full"
            >
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Upload & Index Document
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* 3. Connected Knowledge Sources Inventory + Quick Note */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 text-primary" />
              Connected Knowledge Sources ({data.knowledgeDocs.length})
            </CardTitle>
            <CardDescription>
              Every document, website, and bio below powers both 24/7 Jarvis reasoning and WhatsApp customer replies.
            </CardDescription>
          </div>
          {canEdit && data.knowledgeDocs.some((d) => d.source_type === 'website') && (
            <Button
              variant="outline"
              size="sm"
              disabled={syncingUrlId !== null}
              onClick={() => void handleResyncWebsite()}
            >
              {syncingUrlId === 'all' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Re-sync All Websites
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {data.knowledgeDocs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No knowledge sources indexed yet. Save your Company Bio, crawl a website, or upload a document above.
            </p>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {data.knowledgeDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm font-medium text-foreground">
                        {doc.title}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          SOURCE_BADGES[doc.source_type] ?? SOURCE_BADGES.manual
                        }`}
                      >
                        {doc.source_type.replace('_', ' ')}
                      </span>
                      {doc.sync_status === 'error' && (
                        <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-400">
                          sync error
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {doc.source_url || doc.file_name || 'Manual entry'} ·{' '}
                      {doc.chunk_count || 0} chunks · {(doc.char_count || 0).toLocaleString()} chars
                      {doc.auto_sync_hours ? ` · auto-sync ${doc.auto_sync_hours}h` : ''}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-1">
                      {doc.source_type === 'website' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={syncingUrlId !== null}
                          onClick={() => void handleResyncWebsite(doc.id)}
                          title="Re-crawl URL"
                        >
                          {syncingUrlId === doc.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => void handleDeleteDoc(doc.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {canEdit && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
              <p className="text-xs font-semibold text-foreground">
                Quick Paste Note / Sales Playbook
              </p>
              <Input
                placeholder="Title (e.g. Objection Handling Playbook)"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                disabled={savingManual}
              />
              <Textarea
                rows={3}
                placeholder="Paste any internal guidelines, scripts, or product notes…"
                value={manualContent}
                onChange={(e) => setManualContent(e.target.value)}
                disabled={savingManual}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={savingManual || !manualTitle.trim() || !manualContent.trim()}
                onClick={handleSaveManual}
              >
                {savingManual ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                )}
                Add & Index Note
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
