import type { SettingsResponse, SiteSettings } from '@s5y/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { parse } from '../../lib/validation.js';
import { settingsInputSchema } from '../../services/settings.js';

export async function settingsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const respond = (settings: SiteSettings): SettingsResponse => ({
    settings,
    urls: {
      avatarUrl: ctx.serialize.url(settings.about.avatarKey),
      ogImageUrl: ctx.serialize.url(settings.seo.ogImageKey),
    },
  });

  app.get('/settings', async () => respond(await ctx.settings.get()));

  app.put('/settings', async (request) => {
    const next = parse(settingsInputSchema, request.body ?? {}) as SiteSettings;
    const previous = await ctx.settings.get();
    await ctx.files.assertImagesExist({
      'about.avatarKey': next.about.avatarKey !== previous.about.avatarKey ? next.about.avatarKey : null,
      'seo.ogImageKey': next.seo.ogImageKey !== previous.seo.ogImageKey ? next.seo.ogImageKey : null,
    });
    const saved = await ctx.settings.save(next);
    await ctx.files.releaseImages([
      previous.about.avatarKey !== saved.about.avatarKey ? previous.about.avatarKey : null,
      previous.seo.ogImageKey !== saved.seo.ogImageKey ? previous.seo.ogImageKey : null,
    ]);
    request.log.info('site settings updated');
    return respond(saved);
  });
}
