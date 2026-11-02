import { describe, expect, it } from 'vitest';
import { ImageCrop, type CropOptions } from '../../../src/views/image/ImageCrop.js';
import { Fixtures } from '../../support/Fixtures.js';

const GALLERY = 'models/render/gallery.bpmn';
const crop = async (options: CropOptions, file = GALLERY) => new ImageCrop(await Fixtures.read(file)).of(options);

describe('ImageCrop', () => {
  it('asks for no crop by default', async () => {
    expect(await crop({})).toEqual({});
  });

  it('fits the neighbourhood of an id with the data and notes on it', async () => {
    const { fit } = await crop({ around: 'Activity_UserTask', depth: 0 });

    expect(fit).toContain('Activity_UserTask');
    expect(fit?.length).toBeGreaterThan(1);
  });

  it('asks for both ends of a path', async () => {
    await expect(crop({ path: ['Event_InnerStart'] as unknown as [string, string] })).rejects.toMatchObject({ code: 'E_USAGE', message: 'A path takes two ids: where it starts and where it ends' });
  });

  it('fits the shortest path between two ids', async () => {
    const { fit } = await crop({ path: ['Event_InnerStart', 'Event_InnerEnd'] });

    expect(fit?.slice(0, 2)).toEqual(['Event_InnerStart', expect.stringContaining('Flow')]);
  });

  it('crops to a pool with what is drawn inside it', async () => {
    const { fit } = await crop({ ids: ['Participant_Partner'] });

    expect(fit?.[0]).toBe('Participant_Partner');
  });

  it('crops to an expanded sub-process and plain ids as they are', async () => {
    expect((await crop({ ids: ['Activity_ExpandedSubProcess'] })).fit).toContain('Activity_InnerTask');
    expect((await crop({ ids: ['Activity_UserTask', 'Activity_UserTask', 'Activity_ServiceTask'] })).fit).toEqual(['Activity_UserTask', 'Activity_ServiceTask']);
  });

  it('picks the plane of a collapsed sub-process and of a process, and the pool of a process in one', async () => {
    expect(await crop({ ids: ['Activity_CollapsedSubProcess'] })).toEqual({ plane: 'Activity_CollapsedSubProcess' });
    expect(await crop({ ids: ['Process_Gap'] }, 'views/wide-gap.bpmn')).toEqual({ plane: 'Process_Gap' });
    expect((await crop({ ids: ['Process_RenderGallery'] })).fit?.[0]).toBe('Participant_RenderGallery');
  });

  it('refuses two crops, depth without around and an unknown id', async () => {
    await expect(crop({ around: 'Activity_UserTask', ids: ['Activity_UserTask'] })).rejects.toMatchObject({ code: 'E_USAGE' });
    await expect(crop({ depth: 2 })).rejects.toMatchObject({ code: 'E_USAGE' });
    await expect(crop({ ids: ['Nowhere'] })).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });
});
