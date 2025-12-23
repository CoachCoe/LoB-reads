// Test the safeParseCoordinates pattern used in server code
describe("Coordinate parsing", () => {
  function safeParseCoordinates(json: string): { lat: number; lng: number } {
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed.lat === "number" && typeof parsed.lng === "number") {
        return parsed;
      }
      return { lat: 0, lng: 0 };
    } catch {
      return { lat: 0, lng: 0 };
    }
  }

  it("parses valid coordinate JSON", () => {
    const result = safeParseCoordinates('{"lat": 40.7128, "lng": -74.0060}');
    expect(result).toEqual({ lat: 40.7128, lng: -74.0060 });
  });

  it("returns default for invalid JSON", () => {
    const result = safeParseCoordinates("not valid json");
    expect(result).toEqual({ lat: 0, lng: 0 });
  });

  it("returns default for missing lat", () => {
    const result = safeParseCoordinates('{"lng": -74.0060}');
    expect(result).toEqual({ lat: 0, lng: 0 });
  });

  it("returns default for missing lng", () => {
    const result = safeParseCoordinates('{"lat": 40.7128}');
    expect(result).toEqual({ lat: 0, lng: 0 });
  });

  it("returns default for non-numeric lat", () => {
    const result = safeParseCoordinates('{"lat": "40.7128", "lng": -74.0060}');
    expect(result).toEqual({ lat: 0, lng: 0 });
  });

  it("returns default for non-numeric lng", () => {
    const result = safeParseCoordinates('{"lat": 40.7128, "lng": "not a number"}');
    expect(result).toEqual({ lat: 0, lng: 0 });
  });

  it("handles empty string", () => {
    const result = safeParseCoordinates("");
    expect(result).toEqual({ lat: 0, lng: 0 });
  });

  it("handles coordinates at extremes", () => {
    const result = safeParseCoordinates('{"lat": -90, "lng": 180}');
    expect(result).toEqual({ lat: -90, lng: 180 });
  });
});

describe("Coordinate validation", () => {
  function isValidCoordinate(lat: number, lng: number): boolean {
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  it("accepts valid coordinates", () => {
    expect(isValidCoordinate(40.7128, -74.0060)).toBe(true);
    expect(isValidCoordinate(0, 0)).toBe(true);
    expect(isValidCoordinate(-90, 180)).toBe(true);
    expect(isValidCoordinate(90, -180)).toBe(true);
  });

  it("rejects invalid latitude", () => {
    expect(isValidCoordinate(-91, 0)).toBe(false);
    expect(isValidCoordinate(91, 0)).toBe(false);
  });

  it("rejects invalid longitude", () => {
    expect(isValidCoordinate(0, -181)).toBe(false);
    expect(isValidCoordinate(0, 181)).toBe(false);
  });
});
