import type { PlaceSummary } from '@s5y/shared';
import { EmptyFrame } from '../components/EmptyFrame';
import { PlaceCard } from '../components/PlaceCard';
import { Reveal } from '../components/Reveal';
import { SectionHeading } from '../components/SectionHeading';
import { formatNumber } from '../lib/format';

/** 12-column editorial rhythm: 7/5, 5/7, 6/6 … */
const SPANS = ['lg:col-span-7', 'lg:col-span-5', 'lg:col-span-5', 'lg:col-span-7', 'lg:col-span-6', 'lg:col-span-6'];

export function Work({ places, index, total, totalVideos }: { places: PlaceSummary[]; index: number; total: number; totalVideos: number }) {
  const odd = places.length % 2 === 1;
  return (
    <section id="work" aria-labelledby="work-title" className="relative scroll-mt-24 py-24 sm:py-32">
      <div className="container-cine">
        <SectionHeading
          id="work"
          index={index}
          total={total}
          code="WORK"
          kicker="الشغل"
          title={['أماكن صوّرت قصتها']}
          description="كل مكان إله صفحة خاصة بيها كل الفيديوهات اللي سويتها إله — اختار مكان وشوف الشغل بالتفصيل."
          aside={
            places.length > 0 ? (
              <dl className="flex gap-8">
                <div>
                  <dt className="text-sm text-muted">مكان وبراند</dt>
                  <dd className="font-display text-4xl font-extrabold text-text">{formatNumber(places.length)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">فيديو منشور</dt>
                  <dd className="font-display text-4xl font-extrabold text-accent">{formatNumber(totalVideos)}</dd>
                </div>
              </dl>
            ) : undefined
          }
        />
        {places.length === 0 ? (
          <EmptyFrame
            title="المشهد الأول قريباً"
            body="جاي أجهّز أول الأماكن والفيديوهات هنا. تابعني على إنستغرام حتى تشوف الجديد أول بأول."
          />
        ) : (
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-12">
            {places.map((place, i) => {
              const lastAlone = odd && i === places.length - 1;
              const span = lastAlone ? 'lg:col-span-12' : (SPANS[i % SPANS.length] ?? 'lg:col-span-6');
              return (
                <Reveal as="li" key={place.id} delay={(i % 2) * 0.08} className={`${span} ${lastAlone ? 'sm:col-span-2' : ''}`}>
                  <PlaceCard place={place} index={i} className="h-[clamp(26rem,42vw,36rem)]" />
                </Reveal>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
