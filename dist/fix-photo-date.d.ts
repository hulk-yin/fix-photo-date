import moment from 'moment';
import { ExifData, CheckDiffOptions } from './types';
export declare function getJpegExifData(filePath: string): Promise<ExifData>;
export declare function parseJpegExifDate(dateString: string): moment.Moment;
export declare function checkDiff(dirPath: string, options: CheckDiffOptions): Promise<void>;
