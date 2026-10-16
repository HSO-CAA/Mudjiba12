import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { CircleAlert, Fingerprint, LayoutTemplate, Phone, Search, Sigma, UserRound } from 'lucide-react';
import type { SettingsResponse, SiteSettings } from '@s5y/shared';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page';
import { SaveBar } from '../../components/ui/save-bar';
import { Tabs } from '../../components/ui/tabs';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { useSaveSettings, useSettings } from './hooks';
import { AboutTab, BrandTab, ContactTab, HomeTab, SeoTab, StatsTab, type SettingsTabProps } from './tabs';

export type SettingsTab = 'brand' | 'about' | 'stats' | 'contact' | 'home' | 'seo';

const TABS: { value: SettingsTab; label: string; icon: ReactNode; sections: (keyof SiteSettings)[] }[] = [
  { value: 'brand', label: 'الهوية', icon: <Fingerprint />, sections: ['brand'] },
  { value: 'about', label: 'نبذة', icon: <UserRound />, sections: ['about'] },
  { value: 'stats', label: 'الأرقام', icon: <Sigma />, sections: ['stats'] },
  { value: 'contact', label: 'التواصل', icon: <Phone />, sections: ['contact'] },
  { value: 'home', label: 'الواجهة', icon: <LayoutTemplate />, sections: ['hero', 'sections'] },
  { value: 'seo', label: 'SEO', icon: <Search />, sections: ['seo'] },
];

export interface Urls {
  avatarUrl: string | null;
  ogImageUrl: string | null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export default function SettingsPage() {
  useDocumentTitle('الإعدادات');
  const settings = useSettings();

  if (settings.isPending) {
    return (
      <div>
        <PageHeader title="إعدادات الموقع" description="كل النصوص والصور والروابط اللي تطلع بالموقع العام." />
        <Skeleton className="mb-6 h-11 w-full max-w-xl" />
        <Skeleton className="h-[28rem] rounded-2xl" />
      </div>
    );
  }
  if (settings.isError) {
    return (
      <Card>
        <EmptyState icon={<CircleAlert />} title="تعذّر تحميل الإعدادات" description={settings.error.message} action={<Button onClick={() => void settings.refetch()}>إعادة المحاولة</Button>} />
      </Card>
    );
  }
  return <SettingsEditor data={settings.data} />;
}

function SettingsEditor({ data }: { data: SettingsResponse }) {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab') as SettingsTab | null;
  const tab: SettingsTab = TABS.some((t) => t.value === tabParam) ? (tabParam as SettingsTab) : 'brand';
  const setTab = (next: SettingsTab) => setParams(next === 'brand' ? {} : { tab: next }, { replace: true });

  const save = useSaveSettings({ silent: true });
  const [base, setBase] = useState<SiteSettings>(data.settings);
  const [doc, setDoc] = useState<SiteSettings>(data.settings);
  const [urls, setUrls] = useState<Urls>(data.urls);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = useMemo(() => !same(doc, base), [doc, base]);
  useUnsavedGuard(dirty);

  // Pick up server changes (e.g. the plans switch) while nothing is being edited.
  useEffect(() => {
    if (dirty) return;
    setBase(data.settings);
    setDoc(data.settings);
    setUrls(data.urls);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow the server copy only
  }, [data]);

  const update = <K extends keyof SiteSettings>(section: K, value: SiteSettings[K]) => {
    setDoc((d) => ({ ...d, [section]: value }));
    setErrors((prev) => {
      const prefix = `${String(section)}.`;
      const next = Object.fromEntries(Object.entries(prev).filter(([k]) => k !== section && !k.startsWith(prefix)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  };

  const onSave = () => {
    save.mutate(doc, {
      onSuccess: (response) => {
        setBase(response.settings);
        setDoc(response.settings);
        setUrls(response.urls);
        setErrors({});
        toast.success('تم حفظ الإعدادات', { description: 'التغييرات تطلع بالموقع خلال ثواني.' });
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
          const fields = error.fieldErrors;
          setErrors(fields);
          const first = Object.keys(fields)[0]?.split('.')[0];
          const owner = TABS.find((t) => t.sections.includes(first as keyof SiteSettings));
          if (owner && owner.value !== tab) setTab(owner.value);
        }
        toast.error(error instanceof ApiError ? error.message : 'تعذّر حفظ الإعدادات');
      },
    });
  };

  const tabErrors = (t: (typeof TABS)[number]) => Object.keys(errors).some((k) => t.sections.includes(k.split('.')[0] as keyof SiteSettings));
  const props: SettingsTabProps = { doc, update, errors, urls, setUrls };

  return (
    <div>
      <PageHeader title="إعدادات الموقع" description="كل النصوص والصور والروابط اللي تطلع بالموقع العام. احفظ لمن تخلص." />
      <Tabs
        label="أقسام الإعدادات"
        value={tab}
        onChange={setTab}
        className="mb-6"
        items={TABS.map((t) => ({
          value: t.value,
          icon: t.icon,
          label: (
            <span className="relative">
              {t.label}
              {tabErrors(t) && <span className="absolute -end-2 -top-0.5 size-1.5 rounded-full bg-danger" aria-label="فيه خطأ" />}
            </span>
          ),
        }))}
      />

      <div role="tabpanel">
        {tab === 'brand' && <BrandTab {...props} />}
        {tab === 'about' && <AboutTab {...props} />}
        {tab === 'stats' && <StatsTab {...props} />}
        {tab === 'contact' && <ContactTab {...props} />}
        {tab === 'home' && <HomeTab {...props} />}
        {tab === 'seo' && <SeoTab {...props} />}
      </div>

      <SaveBar
        visible={dirty}
        saving={save.isPending}
        onSave={onSave}
        onDiscard={() => {
          setDoc(base);
          setUrls(data.urls);
          setErrors({});
        }}
      />
    </div>
  );
}
