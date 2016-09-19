var OS = require('./opensubtitles.js'),
    libhash = require('./hash.js'),
    Promise = require('bluebird'),
    _ = require('lodash');

var LibSearch = function() {};

LibSearch.prototype.optimizeQueryTerms = function(input) {
    var checkHash = function() {
        return new Promise(function(resolve, reject) {
            if (!input.hash && !input.path) {
                resolve(false);
            }
            var tmpObj = {};

            if (!input.hash && input.path) {
                // calc hash if path exists
                libhash.computeHash(input.path)
                    .then(resolve)
                    .catch(reject);
            } else {
                tmpObj.moviehash = input.hash;
                if (input.filesize) {
                    tmpObj.moviebytesize = input.filesize.toString();
                }
                resolve(tmpObj);
            }
        });
    };


    return new Promise(function(resolve, reject) {
        var i = 0,
            output = [];

        checkHash().then(function(obj) {
            // first data call
            if (obj) {
                output[i] = obj;
                i++;
            }

            // second data call
            if (input.filename || input.path) {
                output[i] = {};
                output[i].tag = input.filename || require('path').basename(input.path);
                i++;
            }

            // third data call
            if (input.imdbid) {
                output[i] = {};
                output[i].imdbid = input.imdbid.toString().replace('tt', '');

                if (input.season && input.episode) {
                    output[i].season = parseInt(input.season).toString();
                    output[i].episode = parseInt(input.episode).toString();
                }
                i++;
            }

            // fallback
            if (!input.imdbid && !input.hash && !input.path && !input.filename && input.query) {
                output[i] = {};
                output[i].query = input.query;

                if (input.season && input.episode) {
                    output[i].season = parseInt(input.season).toString();
                    output[i].episode = parseInt(input.episode).toString();
                }
                i++;
            }

            // mandatory parameter
            _.each(output, function(obj) {
                obj.sublanguageid = input.sublanguageid || 'all';
            });

            resolve(output);
        }).catch(reject);
    });
};

LibSearch.prototype.optimizeSubs = function(response, input) {
    // based on OpenSRTJS, under MIT - Copyright (c) 2014 Eóin Martin

    var normalize = (function () {
        var from = "ÃÀÁÄÂÈÉËÊÌÍÏÎÒÓÖÔÙÚÜÛãàáäâèéëêìíïîòóöôùúüûÑñÇç", 
            to =   "AAAAAEEEEIIIIOOOOUUUUaaaaaeeeeiiiioooouuuunncc",
            mapping = {};
        
        for (var i = 0, j = from.length; i < j; i++)
            mapping[ from.charAt(i) ] = to.charAt(i);
        
        return function (str) {
            var ret = [];
            for (var i = 0, j = str.length; i < j; i++) {
                var c = str.charAt(i);
                if (mapping.hasOwnProperty(str.charAt(i)))
                    ret.push(mapping[ c ]);
                else
                    ret.push(c);
            }
            return ret.join('');
        }
    })();
    
    var fileTags;
    var fileTagsDic = {};
    var matchTags = function (sub, maxScore) {
        if (!input.filename) return 0;
        
        if (!fileTags) {
            fileTags = normalize(input.filename)
                .toLowerCase()
                .match(/[a-z0-9]{2,}/gi);
        }
        
        if (fileTags.length === 0) return 0;
        
        var subNames = normalize(sub.MovieReleaseName + '_' + sub.SubFileName);
        var subTags = subNames
            .toLowerCase()
            .match(/[a-z0-9]{2,}/gi);
        
        
        if (subTags.length === 0) return 0;
        
        _.each(fileTags, function (tag) {
            fileTagsDic[tag] = false;
        });
        
        var matches = 0;
        _.each(subTags, function (subTag) {
            if (fileTagsDic[subTag] === false) { // is term in filename, only once
                fileTagsDic[subTag] = true;
                matches++;
            }
        });
        return parseInt((matches / fileTags.length) * maxScore);
    };

    return new Promise(function(resolve, reject) {
        var subtitles = {};

        // if string passed as supported extension, convert to array
        if (input.extensions && typeof input.extensions === 'string') {
            input.extensions = [input.extensions];
        }

        // if no supported extensions passed, default to 'srt'
        if (!input.extensions || !input.extensions instanceof Array) {
            input.extensions = ['srt'];
        }
        
        // parse input
        input.imdbid = input.imdbid && parseInt(input.imdbid.toString().replace('tt', ''), 10);
        
        input.season = input.season && parseInt(input.season);
        input.episode = input.episode && parseInt(input.episode);

        input.hash = input.hash && input.hash.toString().length >= 32 && input.hash.toString().toLowerCase();
        
        input.filesize = input.filesize && parseInt(input.filesize);
        

        // remove duplicate
        var seen = {};
        response = response.filter(function (sub) {
            return seen.hasOwnProperty(sub.IDSubtitle) ? false : (seen[sub.IDSubtitle] = true);
        });

        _.each(response, function(sub) {

            if (input.extensions.indexOf(sub.SubFormat) == -1) {
                return;
            }
            
            
            // imdbid check
            if (input.imdbid) {
                // parse
                if (sub.SeriesIMDBParent && sub.SeriesIMDBParent !== '0') { // normalize imdbid
                    // tv episode
                    sub.imdbid = parseInt(sub.SeriesIMDBParent, 10);
                } else {
                    // movie
                    sub.imdbid = sub.IDMovieImdb && parseInt(sub.IDMovieImdb, 10);
                }

                // check
                if (sub.imdbid && sub.imdbid !== input.imdbid) {
                    return;
                }
            }

            // episode check
            if (input.season && input.episode) {
                // parse 
                sub.season = sub.SeriesSeason && parseInt(sub.SeriesSeason);
                sub.episode = sub.SeriesEpisode && parseInt(sub.SeriesEpisode);

                // check
                if (sub.season !== input.season || sub.episode !== input.episode) {
                    return;
                }
            }
            
            // parse filezise
            if (input.filesize)
                sub.filesize = parseInt(sub.MovieByteSize);
            

            var tmp = {};
            tmp.url = input.gzip ? sub.SubDownloadLink : sub.SubDownloadLink.replace('.gz', '');
            tmp.lang = sub.ISO639;
            tmp.downloads = sub.SubDownloadsCnt;
            tmp.langName = sub.LanguageName;
            tmp.encoding = sub.SubEncoding;
            tmp.id = sub.IDSubtitleFile;
            tmp.score = 0;
            
           

            // movie, max score 7
            if (input.imdbid && sub.imdbid === input.imdbid) {
                tmp.score += 5;
            }
            if (input.season && input.episode
                    && sub.season === input.season
                    && sub.episode === input.episode) {
                tmp.score += 2;

            }
            

            // version, max score 8
                            
            //if same hash or same file size ; max score, else match filename and fps  
            if (input.hash && sub.MovieHash.toLowerCase() === input.hash 
                    || input.filesize && input.filesize === sub.filesize) {
                tmp.score += 8;
            } else {
                if (input.filename) {
                    tmp.score += matchTags(sub, 7);
                }
                if ((input.fps && sub.MovieFPS && parseInt(sub.MovieFPS) > 0) 
                        && (sub.MovieFPS.startsWith(input.fps) || input.fps.toString().startsWith(sub.MovieFPS))) {
                    tmp.score += 1;
                }
            }

            // rank 
            if (sub.UserRank === 'trusted' || sub.UserRank === 'administrator') {
                tmp.score += 3;
            } else if (sub.UserRank === 'platinum member' || sub.UserRank === 'gold member') {
                tmp.score += 2;
            }
            

            // store subs for sorting
            if (!subtitles[tmp.lang]) {
                subtitles[tmp.lang] = [];
                subtitles[tmp.lang][0] = tmp;
            } else {
                subtitles[tmp.lang][Object.keys(subtitles[tmp.lang]).length] = tmp;
            }
        });
        resolve(subtitles);
    });
};

LibSearch.prototype.filter = function(list, input) {

    return new Promise(function(resolve, reject) {
        var subtitles = {},
            langcode;

        if (!input.limit || (isNaN(input.limit) && ['best', 'all'].indexOf(input.limit.toLowerCase()) == -1)) {
            input.limit = 'best';
        }

        _.each(list, function(lang) {
            langcode = lang[0].lang;

            // sort by score, sub-sort by downloads
            lang = lang.sort(function(a, b) {
                if (a.score === b.score) {
                    var x = a.downloads,
                        y = b.downloads;
                    return y < x ? -1 : y > x ? 1 : 0;
                }
                return b.score - a.score;
            });

            // filter
            switch (input.limit.toString().toLowerCase()) {
                case 'best':
                    // keep only the first (best) item
                    subtitles[langcode] = lang[0];
                    break;
                case 'all':
                    // all good already
                    subtitles[langcode] = lang;
                    break;
                default:
                    // keep only n = input.limit items
                    subtitles[langcode] = lang.slice(0, parseInt(input.limit));
            };
        });

        resolve(subtitles);
    });
};

module.exports = new LibSearch();