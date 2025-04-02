import { Stats } from 'fs';
import { Moment } from 'moment';
export interface FileItem {
    path: string;
    stats: Stats;
    type: string | null;
}
export interface ExifData {
    gps?: any;
    image: {
        Make?: string;
        Model?: string;
        Orientation?: number;
        XResolution?: number;
        YResolution?: number;
        ResolutionUnit?: number;
        Software?: string;
        ModifyDate?: string;
    };
    exif: {
        ISO?: number;
        ExifVersion?: string;
        DateTimeOriginal?: string;
        CreateDate?: string;
        ShutterSpeedValue?: number;
        ApertureValue?: number;
        BrightnessValue?: number;
        ExposureCompensation?: number;
        MaxApertureValue?: number;
        MeteringMode?: number;
        Flash?: number;
        FocalLength?: number;
    };
}
export interface CheckDateOptions {
    fix?: boolean;
    referenceDate?: Moment;
    force?: boolean;
    outfile?: string;
}
export interface CheckDiffOptions {
    fix?: boolean;
    dateFrom?: string;
    force?: boolean;
    dateFromName?: boolean;
    dateFormat?: string;
    outPath?: string;
    outFormat?: string;
}
