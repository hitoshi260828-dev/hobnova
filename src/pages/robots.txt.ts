import type { APIRoute } from 'astro';
import { SITE_URL } from '../consts';

export const GET: APIRoute = ({ site }) => {
  const siteUrl = site?.toString().replace(/\/$/, '') ?? SITE_URL;
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap-index.xml\n`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
