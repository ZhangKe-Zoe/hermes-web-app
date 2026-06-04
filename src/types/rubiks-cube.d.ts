declare module 'rubiks-cube' {
  class Cube {
    constructor(other?: unknown);
    cp: number[];
    co: number[];
    ep: number[];
    eo: number[];
    c: number[];
    static identity(): Cube;
    static random(): Cube;
    static scramble(scramble: string): Cube;
    scramble(scramble: string): this;
    multiply(cube_info: unknown, times?: number): this;
    inverse(): Cube;
    isSolved(): boolean;
    hash(): string;
    orient(): this;
  }
  export default Cube;
}
