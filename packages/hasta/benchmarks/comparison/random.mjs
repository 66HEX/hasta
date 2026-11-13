export class Random {
  constructor(seed) {
    this.initial = seed >>> 0;
    this.reset();
  }

  reset() {
    this.value = this.initial;
    this.spare = null;
  }

  uniform() {
    this.value = (Math.imul(this.value, 1664525) + 1013904223) >>> 0;

    return (this.value + 0.5) / 2 ** 32;
  }

  normal() {
    if (this.spare !== null) {
      const value = this.spare;
      this.spare = null;

      return value;
    }

    const radius = Math.sqrt(-2 * Math.log(this.uniform()));
    const angle = 2 * Math.PI * this.uniform();
    this.spare = radius * Math.sin(angle);

    return radius * Math.cos(angle);
  }

  snapshot() {
    return { value: this.value, spare: this.spare };
  }

  restore(snapshot) {
    this.value = snapshot.value;
    this.spare = snapshot.spare;
  }
}
