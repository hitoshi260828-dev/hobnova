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
  rakutenKeyword?: string;\n  /** 楽天アフィリエイトで計測IDを設定して発行したURL。発行後のURLは改変しない。 */\n  rakutenAffiliateUrl?: string;
  imageUrl?: string;
  checkedAt: string;
}

export const projectors: Projector[] = [
  { id:'benq-th575c', maker:'BenQ', name:'TH575C', price:92808, brightness:3800, brightnessStandard:'ANSI', resolution:'1920 × 1080', lightSource:'ランプ', officialUrl:'https://www.benq.com/ja-jp/projector/cinema/th575c.html', rakutenKeyword:'BenQ TH575C', checkedAt:'2026-09-29' },
  { id:'nebula-p1i', maker:'Anker', name:'Soundcore Nebula P1i', price:59990, brightness:380, brightnessStandard:'ANSI', resolution:'1920 × 1080', weightKg:3.3, os:'Google TV', officialUrl:'https://www.ankerjapan.com/products/d2200', rakutenKeyword:'Nebula P1i', checkedAt:'2026-09-29' },
  { id:'benq-gv32', maker:'BenQ', name:'GV32', price:89800, brightness:500, brightnessStandard:'ANSI', resolution:'1920 × 1080', weightKg:1.6, os:'Google TV', officialUrl:'https://www.benq.com/ja-jp/projector/portable/gv32.html', rakutenKeyword:'BenQ GV32', checkedAt:'2026-09-29' },
  { id:'nebula-capsule-air', maker:'Anker', name:'Nebula Capsule Air', price:49990, brightness:150, brightnessStandard:'ANSI', resolution:'1280 × 720', weightKg:0.65, os:'Google TV', officialUrl:'https://www.ankerjapan.com/collections/mobileprojector', rakutenKeyword:'Nebula Capsule Air', checkedAt:'2026-09-29' },
  { id:'nebula-capsule-3', maker:'Anker', name:'Nebula Capsule 3', price:89990, brightness:200, brightnessStandard:'ANSI', resolution:'1920 × 1080', weightKg:0.85, os:'Google TV', officialUrl:'https://www.ankerjapan.com/collections/mobileprojector', rakutenKeyword:'Nebula Capsule 3', checkedAt:'2026-09-29' },
];

export const getProjector = (id: string) => projectors.find((projector) => projector.id === id);

export const pricePerLumen = (projector: Projector) => projector.price / projector.brightness;
