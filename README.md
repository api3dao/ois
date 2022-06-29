# `@api3/ois`

> OIS (or Oracle Integration Specifications) is a JSON object that describes an API specification

You can find the documentation for OIS in the [docs](https://docs.api3.org/ois/latest/).

## Installation

To install this package run either:

`yarn add @api3/ois`

or if you use npm:

`npm install @api3/ois --save`

## Usage

The OIS package defines validation and TypeScript typings that can be used to verify correctness of a full OIS schema or
just a part of it. For example:

```js
const { oisSchema } = require('@api3/ois');

const possibleOis = {
  oisFormat: '1.0.0',
  version: '1.2.3',
  title: 'coinlayer',
  apiSpecifications: { ... } // omitted for brevity
  endpoints: [ ... ], // omitted for brevity
};
const result = oisSchema.safeParse(possibleOis);
if (!result.success) {
  throw result.error
} else {
  const validOis = result.data
}
```

### Example

An example of a valid OIS can be found [here](https://github.com/api3dao/ois/blob/main/test/fixtures/ois.json).

## Developer documentation

### Release

To release a new version follow these steps:

1. `git checkout main && git pull` - ensure you are on a "main" branch with latest changes
2. `yarn version` - choose "x.y.z" as the version to be released
3. `yarn build` - only build the package after the "yarn version" command so the bundled "package.json" uses the updated
   version
4. `yarn publish --access public`
5. `git push --follow-tags` - to push the commits to a "main" branch
