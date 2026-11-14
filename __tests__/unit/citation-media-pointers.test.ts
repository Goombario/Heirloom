import { describe, expect, it } from 'vitest';
import { takeCitationMediaPointers } from '@/lib/gedcom/raw-pointers';

describe('takeCitationMediaPointers (#47)', () => {
    it('takes a citation file pointer and keeps the rest', () => {
        expect(takeCitationMediaPointers('1 OBJE @~O:7@\n1 _X kept\n1 OBJE @~O:9@')).toEqual({ raw: '1 _X kept', mediaIds: [7, 9] });
    });

    it('leaves nothing behind when the pointer was all there was', () => {
        expect(takeCitationMediaPointers('1 OBJE @~O:7@')).toEqual({ raw: null, mediaIds: [7] });
    });

    it('keeps a pointer with sub-lines, an inline OBJE and a deeper pointer as passthrough', () => {
        const raw = '1 OBJE @~O:7@\n2 TITL Page 3\n1 OBJE\n2 FILE a.jpg\n1 _X\n2 OBJE @~O:8@';
        expect(takeCitationMediaPointers(raw)).toEqual({ raw, mediaIds: [] });
    });

    it('takes a repeated pointer once', () => {
        expect(takeCitationMediaPointers('1 OBJE @~O:7@\n1 OBJE @~O:7@')).toEqual({ raw: null, mediaIds: [7] });
    });
});
