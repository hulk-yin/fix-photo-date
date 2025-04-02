declare module 'exif' {
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

    export interface ExifImageOptions {
        image: string;
    }

    export interface ExifImageConstructor {
        new(options: ExifImageOptions, callback: (error: Error | null, data: ExifData) => void): void;
    }

    export const ExifImage: ExifImageConstructor;
} 