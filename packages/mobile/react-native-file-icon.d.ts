declare module 'react-native-file-icon' {
  import type { ComponentType } from 'react';
  import type { SvgProps } from 'react-native-svg';

  interface FileIconProps extends SvgProps {
    color?: string;
    extension?: string;
    fold?: boolean;
    foldColor?: string;
    glyphColor?: string;
    gradientColor?: string;
    gradientOpacity?: number;
    labelColor?: string;
    labelTextColor?: string;
    labelUppercase?: boolean;
    radius?: number;
    size?: number;
    type?: string;
  }

  export const defaultStyles: Record<string, Partial<FileIconProps>>;

  const FileIcon: ComponentType<FileIconProps>;
  export default FileIcon;
}
