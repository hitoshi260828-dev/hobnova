export interface Projector {
  id: string;
  maker: string;
  name: string;
  price: number;
  brightness: number;
  brightnessStandard: 'ANSI' | 'ISO';
  resolution: string;
  weightKg?: number;
  os?: string;
  lightSource?: string;
  officialUrl: string;
  amazonAsin?: string;
  rakutenKeyword?: string;
  /** 楽天アフィリエイトで計測IDを設定して発行したURL。発行後のURLは改変しない。 */
  rakutenAffiliateUrl?: string;
  /**
   * Amazon Creators API が返した画像URL。
   * Amazonの商品ページからスクレイピングしたURLや、ダウンロードした画像は保存しない。
   * API利用可能後は scripts/refresh-amazon-product-images.mjs で更新する。
   */
  amazonImageUrl?: string;
  /** Amazon画像情報をCreators APIから最後に更新した日時。 */
  amazonImageCheckedAt?: string;
  /** Amazon以外の権利確認済み画像を使う場合のみ設定する。 */
  imageUrl?: string;
  checkedAt: string;
}

export const projectors: Projector[] = [
  { id:'benq-th575c', maker:'BenQ', name:'TH575C', price:92808, brightness:3800, brightnessStandard:'ANSI', resolution:'1920 × 1080', lightSource:'ランプ', officialUrl:'https://www.benq.com/ja-jp/projector/cinema/th575c.html', rakutenKeyword:'BenQ TH575C', checkedAt:'2026-09-29' },
  { id:'nebula-p1i', maker:'Anker', name:'Soundcore Nebula P1i', price:59990, brightness:380, brightnessStandard:'ANSI', resolution:'1920 × 1080', weightKg:3.3, os:'Google TV', officialUrl:'https://www.ankerjapan.com/products/d2200', amazonAsin:'B0FY2XXWPJ', rakutenKeyword:'Nebula P1i', checkedAt:'2026-09-29' },
  { id:'benq-gv32', maker:'BenQ', name:'GV32', price:89800, brightness:500, brightnessStandard:'ANSI', resolution:'1920 × 1080', weightKg:1.6, os:'Google TV', officialUrl:'https://www.benq.com/ja-jp/projector/portable/gv32.html', rakutenKeyword:'BenQ GV32', checkedAt:'2026-09-29' },
  { id:'nebula-capsule-air', maker:'Anker', name:'Nebula Capsule Air', price:49990, brightness:150, brightnessStandard:'ANSI', resolution:'1280 × 720', weightKg:0.65, os:'Google TV', officialUrl:'https://www.ankerjapan.com/collections/mobileprojector', amazonAsin:'B0CXY3S1MP', rakutenKeyword:'Nebula Capsule Air', checkedAt:'2026-09-29' },
  { id:'nebula-capsule-3', maker:'Anker', name:'Nebula Capsule 3', price:89990, brightness:200, brightnessStandard:'ANSI', resolution:'1920 × 1080', weightKg:0.85, os:'Google TV', officialUrl:'https://www.ankerjapan.com/collections/mobileprojector', amazonAsin:'B0CJDV213W', rakutenKeyword:'Nebula Capsule 3', checkedAt:'2026-09-29' },
];

export const getProjector = (id: string) => projectors.find((projector) => projector.id === id);

export const pricePerLumen = (projector: Projector) => projector.price / projector.brightness;
