import cityCodes from './cityCodes.json';

export type CityOption = { name: string; code: string };

export const CITY_OPTIONS: CityOption[] = Object.entries(cityCodes).map(([name, code]) => ({ name, code }));

const POPULAR_CITY_NAMES = [
  '全国', '北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京', '西安',
  '长沙', '重庆', '苏州', '天津', '厦门', '福州', '合肥', '郑州', '济南', '青岛', '大连',
];

const cityByName = new Map(CITY_OPTIONS.map((city) => [city.name, city]));

export const POPULAR_CITY_OPTIONS = POPULAR_CITY_NAMES
  .map((name) => cityByName.get(name))
  .filter((city): city is CityOption => Boolean(city));
