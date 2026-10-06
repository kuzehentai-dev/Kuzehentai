/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Episode } from '../types';

/**
 * Normalizes any episode data structure (Array or Firestore Object Map) into a clean, typed Episode[] array
 */
export function normalizeEpisodesList(eps: any): Episode[] {
  if (!eps) return [];
  const result: Episode[] = [];

  if (Array.isArray(eps)) {
    eps.forEach((ep, idx) => {
      if (!ep) return;
      if (typeof ep === 'string') {
        const link = ep.trim();
        if (link) {
          result.push({
            number: idx + 1,
            mp4Url: link,
            telegramUrl: link,
            url: link,
            videoUrl: link,
            link: link
          });
        }
      } else if (typeof ep === 'object') {
        const number = Number(ep.number || ep.epNumber || ep.episode || ep.cap || (idx + 1)) || (idx + 1);
        const link = String(
          ep.mp4Url || ep.telegramUrl || ep.url || ep.videoUrl || ep.link || ep.embedUrl || ep.streamUrl || ''
        ).trim();
        if (link) {
          result.push({
            number,
            mp4Url: link,
            telegramUrl: link,
            url: link,
            videoUrl: link,
            link: link,
            isNew: Boolean(ep.isNew),
            ...(ep.title ? { title: String(ep.title) } : {}),
            ...(ep.coverImage ? { coverImage: String(ep.coverImage) } : {}),
            ...(ep.thumbnail ? { thumbnail: String(ep.thumbnail) } : {}),
            ...(ep.addedToRecentAt ? { addedToRecentAt: String(ep.addedToRecentAt) } : {})
          });
        }
      }
    });
  } else if (typeof eps === 'object') {
    Object.keys(eps).forEach(key => {
      const val = eps[key];
      if (!val) return;
      const number = Number(key) || 1;
      let link = '';
      let title = '';
      let isNew = false;
      let coverImage: string | undefined = undefined;
      let thumbnail: string | undefined = undefined;
      let addedToRecentAt: string | undefined = undefined;

      if (typeof val === 'string') {
        link = val.trim();
      } else if (typeof val === 'object') {
        link = String(val.mp4Url || val.telegramUrl || val.url || val.videoUrl || val.link || '').trim();
        if (val.title) title = String(val.title);
        if (val.name) title = String(val.name);
        if (val.isNew) isNew = true;
        if (val.coverImage) coverImage = String(val.coverImage);
        if (val.thumbnail) thumbnail = String(val.thumbnail);
        if (val.addedToRecentAt) addedToRecentAt = String(val.addedToRecentAt);
      }

      if (link) {
        result.push({
          number,
          mp4Url: link,
          telegramUrl: link,
          url: link,
          videoUrl: link,
          link: link,
          isNew: Boolean(isNew),
          ...(title ? { title } : {}),
          ...(coverImage ? { coverImage } : {}),
          ...(thumbnail ? { thumbnail } : {}),
          ...(addedToRecentAt ? { addedToRecentAt } : {})
        });
      }
    });
  }

  return result.sort((a, b) => a.number - b.number);
}
