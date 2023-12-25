import { S, stime } from "@thegraid/common-lib";
import { NamedObject } from "./game-play";

/** Simple async Image loader [from ImageReveal.loadImage()]
 *
 * see also: createjs.ImageLoader, which we don't use.
 */
export class ImageLoader {
  static ipser = 0; // debug
  /**
   * Promise to load url as HTMLImageElement
   */
  loadImage(fname0: string, ext = this.ext): Promise<HTMLImageElement> {
    const fname = fname0.split('.')[0];
    const ip0  = this.ipmap.get(fname);
    if (ip0) {
      return ip0;
    }
    const url = `${this.root}${fname}.${ext}`;
    //console.log(stime(`image-loader: try loadImage`), url)
    const ip = new Promise<HTMLImageElement>((res, rej) => {
      const img: HTMLImageElement = new Image();
      img.onload = (evt => {
        (img as NamedObject).Aname = fname;
        this.imap.set(fname, img);  // record image as loaded!
        res(img);
      });
      img.onerror = ((err) => rej(`failed to load ${url} -> ${err}`));
      img.src = url; // start loading
    });
    // ip['Aname'] = `${fname}-${++ImageLoader.ipser}`;
    this.ipmap.set(fname, ip);
    return ip;
  }

  /**
   * load all fnames, return Promise.all()
   * @param fnames
   */
  loadImages(fnames = this.fnames, ext = this.ext) {
    fnames.forEach(fname => this.ipmap.set(fname, this.loadImage(fname, ext)));
    return this.imageMapPromise =  Promise.all(this.ipmap.values()).then(
      (images) => this.imap, (reason) => {
        console.error(stime(this, `loadImages failed: ${reason}`));
        return this.imap;
      });
  }

  /**
   *
   * @param args -
   * - root: path to image directory with trailing '/'
   * - fnames: string[] basenames of each image to load
   * - ext: file extension (for ex: 'png' or 'jpg')
   *
   * @param imap supply or create new Map()
   * @param cb invoked with (imap)
   */
  constructor(args: { root: string, fnames: string[], ext: string },
    cb?: (imap: Map<string, HTMLImageElement>) => void)
  {
    this.root = args.root;
    this.fnames = args.fnames;
    this.ext = args.ext;
    if (cb) {
      this.loadImages().then(imap => cb(imap));
    }
  }
  imap = new Map<string, HTMLImageElement>();
  ipmap = new Map<string, Promise<HTMLImageElement>>();
  readonly root: string;
  readonly fnames: string[];
  readonly ext: string;
  imagePromises: Promise<HTMLImageElement>[];
  imageMapPromise: Promise<Map<string, HTMLImageElement>>
}
