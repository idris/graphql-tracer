import { makeExecutableSchema } from 'graphql-tools';
import { expect } from 'chai';
import { graphql } from 'graphql';
import { Tracer } from '../src/Tracer.js';

const request = require('request'); // just to override it

describe('Tracer', () => {
  const shorthand = `
    type RootQuery {
      returnArg(name: String): String
      returnErr: String
      returnPromiseArg(name: String): String
      returnPromiseErr: String
      returnUndefined: Int
      returnNull: Int
    }
    schema {
      query: RootQuery
    }
  `;

  const resolver = {
    RootQuery: {
      returnArg: (root, { name }) => {
        // return `${name}`;
        return name;
      },
      returnErr: () => {
        throw new Error('aargh!');
      },
      returnPromiseArg: (root, { name }) => {
        return Promise.resolve(name);
      },
      returnPromiseErr: () => {
        return new Promise((resolve, reject) => {
          setTimeout(() => { reject(new Error('err')); }, 0);
        });
      },
      returnUndefined: () => undefined,
      returnNull: () => null,
    },
  };

  const t1 = new Tracer({ TRACER_APP_KEY: 'BDE05C83-E58F-4837-8D9A-9FB5EA605D2A' });
  const jsSchema = makeExecutableSchema({
    typeDefs: shorthand,
    resolvers: resolver,
    allowUndefinedInResolve: true,
  });

  it('throws an error if you construct it without valid TRACER_APP_KEY', () => {
    expect(() => {
      // eslint-disable-next-line no-unused-vars
      const t = new Tracer({ TRACER_APP_KEY: 'uga' });
    }).to.throw('Tracer requires a well-formatted TRACER_APP_KEY');
  });

  it('does basic tracing for non-promises', () => {
    const testQuery = `{
      returnArg(name: "it")
    }`;
    const tracer = t1.newLoggerInstance();
    return graphql(jsSchema, testQuery, null, { tracer }, null, null, tracer.graphqlLogger).then(() => {
      const report = tracer.report('');
      expect(report.events.length).to.equal(4);
    });
  });

  it('does basic tracing for non-promise throwing an error', () => {
    const tracer = t1.newLoggerInstance();
    const testQuery = `{
      returnErr
    }`;
    return graphql(jsSchema, testQuery, null, { tracer }, null, null, tracer.graphqlLogger).then(() => {
      const report = tracer.report('');
      expect(report.events.length).to.equal(6);
    });
  });

  it('does basic tracing for promises', () => {
    const tracer = t1.newLoggerInstance();
    const testQuery = `{
      returnPromiseArg(name: "it")
    }`;
    return graphql(jsSchema, testQuery, null, { tracer }, null, null, tracer.graphqlLogger).then(() => {
      const report = tracer.report('');
      expect(report.events.length).to.equal(4);
    });
  });

  it('does basic tracing for promise that throws an error', () => {
    const tracer = t1.newLoggerInstance();
    const testQuery = `{
      returnPromiseErr
    }`;
    return graphql(jsSchema, testQuery, null, { tracer }, null, null, tracer.graphqlLogger).then(() => {
      const report = tracer.report('');
      expect(report.events.length).to.equal(6);
    });
  });
  it('does not throw an error if the resolve function returns undefined', () => {
    const tracer = t1.newLoggerInstance();
    const testQuery = `{
      returnUndefined
    }`;
    return graphql(jsSchema, testQuery, null, { tracer }, null, null, tracer.graphqlLogger).then((res) => {
      const report = tracer.report('');
      expect(report.events.length).to.equal(4);
      expect(res.data.returnUndefined).to.equal(null);
      expect(res.errors).to.equal(undefined);
    });
  });
  it('does not throw an error if the resolve function returns null', () => {
    const tracer = t1.newLoggerInstance();
    const testQuery = `{
      returnNull
    }`;
    return graphql(jsSchema, testQuery, null, { tracer }, null, null, tracer.graphqlLogger).then((res) => {
      const report = tracer.report('');
      expect(report.events.length).to.equal(4);
      expect(res.data.returnNull).to.equal(null);
      expect(res.errors).to.equal(undefined);
    });
  });
  it('does not add tracing to schema if already added', () => {
    const tracer = t1.newLoggerInstance();
    const testQuery = `{
      returnPromiseErr
    }`;
    return graphql(jsSchema, testQuery, null, { tracer }, null, null, tracer.graphqlLogger).then(() => {
      const report = tracer.report('');
      expect(report.events.length).to.equal(6);
    });
  });

  // send report tests
  it('calls sendReport with the right arguments', () => {
    const t2 = new Tracer({ TRACER_APP_KEY: 'BDE05C83-E58F-4837-8D9A-9FB5EA605D2A' });
    let interceptedReport = null;
    // test harness for submit
    t2.sendReport = (report) => { interceptedReport = report; };
    const tracer = t2.newLoggerInstance();
    const testQuery = `{
      returnPromiseErr
    }`;
    return graphql(jsSchema, testQuery, null, { tracer }, null, null, tracer.graphqlLogger).then(() => {
      tracer.submit();
      const expected = [
        'TRACER_APP_KEY',
        'events',
        'queryId',
        'startHrTime',
        'startTime',
        'tracerApiVersion',
      ];
      expect(Object.keys(interceptedReport).sort()).to.deep.equal(expected);
      expect(interceptedReport.events.length).to.equal(6);
    });
  });

  it('calls request with the right arguments to report', () => {
    let interceptedReport = null;
    // test harness for submit
    const realRequest = request.Request;
    request.Request = (params) => {
      interceptedReport = params.json;
    };
    const tracer = t1.newLoggerInstance();
    const testQuery = `{
      returnPromiseErr
    }`;
    return graphql(jsSchema, testQuery, null, { tracer }, null, null, tracer.graphqlLogger).then(() => {
      tracer.submit();
      const expected = [
        'TRACER_APP_KEY',
        'events',
        'queryId',
        'startHrTime',
        'startTime',
        'tracerApiVersion',
      ];
      request.Request = realRequest;
      expect(Object.keys(interceptedReport).sort()).to.deep.equal(expected);
      expect(interceptedReport.events.length).to.equal(6);
    });
  });

  it('filters events in sendReport if you tell it to', () => {
    const t2 = new Tracer({
      TRACER_APP_KEY: 'BDE05C83-E58F-4837-8D9A-9FB5EA605D2A',
      reportFilterFn: (e) => (e.type !== 'resolver.end' && e.type !== 'subtree.end'),
    });
    let interceptedReport = null;
    // test harness for submit
    const realRequest = request.Request;
    request.Request = (params) => {
      interceptedReport = params.json;
    };
    const tracer = t2.newLoggerInstance();
    const testQuery = `{
      returnPromiseErr
    }`;
    return graphql(jsSchema, testQuery, null, { tracer }, null, null, tracer.graphqlLogger).then(() => {
      tracer.submit();
      request.Request = realRequest;
      expect(interceptedReport.events.length).to.equal(4);
      expect(interceptedReport.events[0].type).to.equal('resolver.start');
    });
  });


  it('does not send report if sendReports is false', () => {
    const t2 = new Tracer({
      TRACER_APP_KEY: 'BDE05C83-E58F-4837-8D9A-9FB5EA605D2A',
      sendReports: false,
    });
    let interceptedReport = null;
    // test harness for submit
    t2.sendReport = (report) => { interceptedReport = report; };
    const tracer = t2.newLoggerInstance();
    const testQuery = `{
      returnPromiseErr
    }`;
    return graphql(jsSchema, testQuery, null, { tracer }).then(() => {
      tracer.submit();
      expect(interceptedReport).to.equal(null);
    });
  });

  it('prints an error if request fails in sendReport', () => {
    // const tracer = t1.newLoggerInstance();
    const realRequest = request.Request;
    let interceptedMsg;
    const realConsoleError = console.error;
    // XXX yeah... maybe use sinon?
    console.error = (msg, err) => { interceptedMsg = [msg, err]; };
    request.Request = ({ callback }) => {
      callback(new Error('nope'));
    };
    t1.sendReport('uga');
    request.Request = realRequest;
    console.error = realConsoleError;
    expect(interceptedMsg[0]).to.equal('Error trying to report to tracer backend:');
    expect(interceptedMsg[1]).to.equal('nope');
  });

  // TODO test calling sendReport with non-json
});
