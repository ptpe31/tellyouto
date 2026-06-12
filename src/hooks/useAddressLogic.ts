import { LAZY_FETCH_SEARCH_MIN_CHARS, MAP_SEARCH_MIN_CHARS } from '../config/mapConfig';
import { usePlaceSearch, type UsePlaceSearchParams, type UsePlaceSearchResult } from './usePlaceSearch';

export { LAZY_FETCH_SEARCH_MIN_CHARS, MAP_SEARCH_MIN_CHARS };

export type UseAddressLogicParams = UsePlaceSearchParams;

export type UseAddressLogicResult = UsePlaceSearchResult;

/** Wrapper rétrocompat — logique dans usePlaceSearch (local-first + Mapbox). */
export function useAddressLogic(params: UseAddressLogicParams): UseAddressLogicResult {
  return usePlaceSearch(params);
}
