import moment from 'moment';
import { getJpegExifData, parseJpegExifDate, getDateFromFileName, checkDate, checkDiff } from '../fix-photo-date';
import { ExifData, FileItem } from '../types';

// Mock dependencies
jest.mock('exif');
jest.mock('exiftool-vendored', () => ({
    exiftool: {
        read: jest.fn(),
        write: jest.fn()
    }
}));
jest.mock('fs', () => ({
    stat: jest.fn(),
    utimes: jest.fn(),
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    renameSync: jest.fn()
}));
jest.mock('globby', () => jest.fn());
jest.mock('mime-types', () => ({
    lookup: jest.fn()
}));

describe('fix-photo-date', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('parseJpegExifDate', () => {
        it('should parse valid date string', () => {
            const dateString = '2024:04:02 12:00:00';
            const result = parseJpegExifDate(dateString);
            expect(result.format('YYYY:MM:DD HH:mm:ss')).toBe(dateString);
        });

        it('should throw error for invalid date string', () => {
            const dateString = 'invalid-date';
            expect(() => parseJpegExifDate(dateString)).toThrow();
        });
    });

    describe('getDateFromFileName', () => {
        it('should extract date from filename with matching format', () => {
            const fileName = '2024-04-02 120000.jpg';
            const format = 'YYYY-MM-DD HHmmss';
            const result = getDateFromFileName(fileName, format);
            expect(result?.format(format)).toBe('2024-04-02 120000');
        });

        it('should return undefined for filename without matching date', () => {
            const fileName = 'photo.jpg';
            const format = 'YYYY-MM-DD HHmmss';
            const result = getDateFromFileName(fileName, format);
            expect(result).toBeUndefined();
        });
    });

    describe('getJpegExifData', () => {
        it('should return exif data', async () => {
            const mockExifData: ExifData = {
                image: {
                    Make: 'Test Camera',
                    Model: 'Test Model',
                    ModifyDate: '2024:04:02 12:00:00'
                },
                exif: {
                    ISO: 100,
                    DateTimeOriginal: '2024:04:02 12:00:00'
                }
            };

            const { ExifImage } = require('exif');
            ExifImage.mockImplementation((options: any, callback: any) => {
                callback(null, mockExifData);
            });

            const result = await getJpegExifData('test.jpg');
            expect(result).toEqual(mockExifData);
        });

        it('should handle errors', async () => {
            const { ExifImage } = require('exif');
            ExifImage.mockImplementation((options: any, callback: any) => {
                callback(new Error('Test error'));
            });

            await expect(getJpegExifData('test.jpg')).rejects.toThrow('Test error');
        });
    });

    describe('checkDate', () => {
        const mockFileItem: FileItem = {
            path: 'test.jpg',
            stats: {
                isFile: () => true,
                atime: new Date('2024-04-02T12:00:00'),
                mtime: new Date('2024-04-02T12:00:00'),
                ctime: new Date('2024-04-02T12:00:00'),
                birthtime: new Date('2024-04-02T12:00:00')
            } as any,
            type: 'image/jpeg'
        };

        beforeEach(() => {
            const { exiftool } = require('exiftool-vendored');
            exiftool.read.mockResolvedValue({
                DateTimeOriginal: new Date('2024-04-02T12:00:00'),
                CreateDate: new Date('2024-04-02T12:00:00')
            });
        });

        it('should return true when dates match', async () => {
            const result = await checkDate(mockFileItem, {});
            expect(result).toBe(true);
        });

        it('should return false when dates differ', async () => {
            const { exiftool } = require('exiftool-vendored');
            exiftool.read.mockResolvedValue({
                DateTimeOriginal: new Date('2024-04-02T13:00:00'),
                CreateDate: new Date('2024-04-02T13:00:00')
            });

            const result = await checkDate(mockFileItem, {});
            expect(result).toBe(false);
        });

        it('should update dates when fix is true', async () => {
            const { exiftool } = require('exiftool-vendored');
            exiftool.read.mockResolvedValue({
                DateTimeOriginal: new Date('2024-04-02T13:00:00'),
                CreateDate: new Date('2024-04-02T13:00:00')
            });

            const result = await checkDate(mockFileItem, { fix: true });
            expect(result).toBe(true);
            expect(exiftool.write).toHaveBeenCalled();
        });
    });

    describe('checkDiff', () => {
        beforeEach(() => {
            const globby = require('globby');
            globby.mockResolvedValue(['test.jpg']);
            
            const fs = require('fs');
            fs.stat.mockImplementation((path: string, callback: (err: Error | null, stats: any) => void) => {
                callback(null, {
                    isFile: () => true,
                    atime: new Date('2024-04-02T12:00:00'),
                    mtime: new Date('2024-04-02T12:00:00'),
                    ctime: new Date('2024-04-02T12:00:00'),
                    birthtime: new Date('2024-04-02T12:00:00')
                });
            });
            fs.existsSync.mockReturnValue(false);
            fs.mkdirSync.mockImplementation(() => {});
            fs.renameSync.mockImplementation(() => {});
            fs.promises = {
                rename: jest.fn().mockResolvedValue(undefined)
            };

            const mime = require('mime-types');
            mime.lookup.mockReturnValue('image/jpeg');

            const { exiftool } = require('exiftool-vendored');
            exiftool.read.mockImplementation((path: string) => {
                if (path === 'reference.jpg') {
                    return Promise.resolve({
                        DateTimeOriginal: new Date('2024-04-02T13:00:00'),
                        CreateDate: new Date('2024-04-02T13:00:00')
                    });
                }
                return Promise.resolve({
                    DateTimeOriginal: new Date('2024-04-02T12:00:00'),
                    CreateDate: new Date('2024-04-02T12:00:00')
                });
            });
            exiftool.write.mockResolvedValue({});
        });

        it('should process files in directory', async () => {
            await checkDiff('test-dir', {});
            const { exiftool } = require('exiftool-vendored');
            expect(exiftool.read).toHaveBeenCalled();
        }, 10000);

        it('should use reference date when provided', async () => {
            await checkDiff('test-dir', { dateFrom: 'reference.jpg', fix: true, force: true });
            const { exiftool } = require('exiftool-vendored');
            expect(exiftool.write).toHaveBeenCalledWith('test.jpg', {
                AllDates: '2024:04:02 13:00:00'
            });
        }, 10000);
    });
}); 